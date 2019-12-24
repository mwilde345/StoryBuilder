'use strict';
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = require('twilio')(accountSid, authToken);
const dynamoClient = require('./dynamo');
const toSpeech = require('./toSpeech').main;
const s3urls = require('@mapbox/s3urls');
const randomWords = require('random-words');
const shorturl = require('shorturl');
const shorturl2 = require('node-url-shortener');

const MessagingResponse = require('twilio').twiml.MessagingResponse;
const AWS = require('aws-sdk');
const lambda = new AWS.Lambda();
const s3 = new AWS.S3();
const POLLER_LAMBDA = process.env.POLLER_LAMBDA
const sqs = new AWS.SQS({ apiVersion: '2012-11-05' })

function IsJsonString(str) {
    try {
        JSON.parse(str);
    } catch (e) {
        return false;
    }
    return true;
}

async function main(event) {
    console.log(event);
    /**
     * example events:
     * sns https://docs.aws.amazon.com/lambda/latest/dg/with-sns.html
     * sms:
     * * New Game
     * * <Response>
     * * Join <Room>
     * * Name <Name>
     * * Ready
     */
    if ("Records" in event) {
        // it's from sns
        let record = event.Records[0].Sns.Message//JSON.parse(event.Records[0].Sns.Message);
        console.log('record sns ', record);
        record = IsJsonString(record) ? JSON.parse(record) : record;
        if ("roomCode" in record) {
            // it's from the poller
            return endRound(record);
        } else {
            // it's from the voice
            return voice(record);
        }

    } else if ("SmsMessageSid" in event) {
        // TODO: if they are not in Players DB and it doesn't have Join, do nothing, or say 
        //  'Welcome, text New Game'

        // it's from twilio
        let message = event.Body;
        event.From = unescape(event.From);
        message = message.replace(/\+/gi, ' ');
        console.log('received twilio message ', message);
        let player = await dynamoClient.getPlayer({ number: event.From });
        if (message.toLowerCase().replace(/ /gi, '').trim().startsWith('newgame')) {
            console.log('they said new  game')
            //TODO: if in game, use as response
            let roomCode = makeid(4).toUpperCase();
            if (player == undefined || player == null) {
                player = await dynamoClient.putPlayer({
                    number: event.From,
                    currentRoom: roomCode,
                    roomHistory: [roomCode]
                })
            }
            return newGame(event.From, roomCode, player);
        }
        else if (message.toLowerCase().replace(/ /gi, '').trim().startsWith('ready')) {
            return ready(event);
        }
        else if (message.toLowerCase().replace(/ /gi, '').trim().startsWith('join')) {
            let roomCode = message.match(/(Join)([,]?)(.*)/i)[3].trim().toUpperCase();
            if (!player) {
                await dynamoClient.putPlayer({
                    number: event.From,
                    roomHistory: [roomCode]
                })
            }
            return join(roomCode, event.From);
        }
        else if (message.toLowerCase().replace(/ /gi, '').trim().startsWith('name')) {
            let name = message.match(/(Name)([,]?)(.*)/i)[3].trim();
            if (!name || !name.length || name.replace(/ /gi, '').length == 0) {
                name = randomWords(1)[0];
            }
            return setName(name, event.From);
        }
        else if (!player || !(player.get('currentRoom'))) {
            // first-timers or need a new game
            return welcome(event.From)
        } else {
            return response(event);
        }
    }
}

async function welcome(From) {
    console.log('sending welcome')
    return sendSMS(From, `Welcome to Story Builder! Respond with 'New Game' to get started. Or join an existing ` +
        `game with 'Join, ROOM_CODE'.`);
}

async function voice(record) {
    console.log('in voice with sns ', record)
    // example URL: https://bucket-name.s3.amazonaws.com/roomCode/voice/1234567.polly-named-file.mp3
    // example outputUri: "s3://story-builder-bucket/roomCode/voice/1234567.polly-named-file.mp3"
    let { outputUri } = record;
    outputUri = outputUri.replace('s3://', '');
    let bucket = outputUri.slice(0, outputUri.indexOf('/'));
    let key = outputUri.slice(outputUri.indexOf('/') + 1, outputUri.length);
    let roomCode = key.match(/(.*?\/)/gi)[0].replace('/', '').toUpperCase();
    let number = '+' + key.match(/([0-9]+\.)/g)[0].replace('.', '');
    // let newKey = `${roomCode}/voice/${number.replace('+','')}.mp3`;
    let url = s3urls.toUrl(bucket, key)["bucket-in-path"];
    // TODO: iphone won't receive the shortened url. not verified??
    // let url = await shortenUrl(s3urls.toUrl(bucket, newKey)["bucket-in-host"]);
    // let url = await shortenUrl(s3urls.toUrl(bucket, key)["bucket-in-host"]);
    // await renameS3(key, newKey)
    console.log('s3 url', url)
    const story = await dynamoClient.getStory({ roomCode, starter: number });
    console.log('story ', story);
    const text = story.get('text');
    const message = `Your story turned out to be: ${text}. Here is the audio! ${url}`;
    console.log('sending final text to ', story.get('starter'));
    return sendSMS(story.get('starter'), message);
    // get the number and roomcode from the s3 object url
    // fetch their story and send it back to them in text, put it on s3,
    // and send a link to the voice in the text.
}

async function shortenUrl(url) {
    return new Promise((res, rej) => {
        shorturl2.short(url, function (err, result) {
            if (err) return rej(err)
            console.log('shortened url: ', result)
            return res(result)
        })
    });
}

async function renameS3(oldKey, newKey) {
    return new Promise((res, rej) => {
        return s3.copyObject({
            Bucket: process.env.S3_BUCKET,
            CopySource: `${process.env.S3_BUCKET}/${oldKey}`,
            Key: newKey
        })
            .promise()
            .then(async () => {
                // Delete the old object
                return s3.deleteObject({
                    Bucket: process.env.S3_BUCKET,
                    Key: oldKey
                }).promise()
                    .then(async (result) => {
                        console.log('done deleting old s3 obj');
                        return res(result);
                    })
                })
            // Error handling is left up to reader
            .catch((e) => {
                console.error(e)
                return rej(e)
            })
    })
}

async function endRound(record) {
    // came from the poller via sns
    // iterate round in the room object.

    // TODO: instead of fetching stuff here, send the data in SNS, but make sure
    //  DB isn't being written to during that time.
    const roomCode = record.roomCode;
    const stories = record.updatedStories;
    const room = await dynamoClient.getRoom(roomCode);
    console.log('got room ', room)
    const players = room.get('players');
    const currentRound = room.get('currentRound');
    console.log('players and round', players, currentRound)
    // const stories = await dynamoClient.getStoriesForRoom().filter(story => {
    //     players.map(player => player.number).includes(story.starter);
    // })
    if (currentRound === players.length) {
        console.log('game over');
        // end the game
        // TODO: text all that game is over and audio is being generated
        // remove currentRoom from all the players
        await asyncForEach(players, async player => {
            let { number } = player;
            console.log(' here is a number ', number)
            // let playerObj = await dynamoClient.getPlayer({ number });
            await dynamoClient.updatePlayer({ number, currentRoom: null });
        })
        console.log('stories', stories);
        // generate voice. Upload it and text to s3. Send the links to each player
        await asyncForEach(stories, async story => {
            console.log('doing speech and text');
            // not a raw story object so no .get
            const text = story.text;
            const starter = story.starter
            await textToS3(text, starter, roomCode.toUpperCase());
            console.log('going to do speech');
            console.log('tospeech function', toSpeech);
            return toSpeech(text, starter, roomCode.toUpperCase());
            // update s3Link in the 'voice' function
        })
    } else {
        if (currentRound === 0) {
            console.log('its the first round')
            await asyncForEach(players, async player => {
                await sendSMS(player.number, `The game is starting! Start your story by responding to this message. ` +
                    `Hurry, you have ${room.get('timeLimit')} seconds!`);
            })
        }
        let updatedRoom = await dynamoClient.updateRoom({
            roomCode, startTime: room.get('startTime'), currentRound: { $add: 1 }, isReady: true
        })
        console.log('upd room ', updatedRoom)
        return updatedRoom
        // return invokeLambda(roomCode.toUpperCase(), players, room.get('timeLimit'))
    }
}

async function asyncForEach(array, callback) {
    for (let index = 0; index < array.length; index++) {
        await callback(array[index], index, array);
    }
}

async function textToS3(text, starter, roomCode) {
    console.log('doing text to s3 with', text, starter, roomCode)
    const params = {
        Bucket: process.env.S3_BUCKET,
        Key: `${roomCode.toUpperCase()}/text/${starter}.txt`, // File name you want to save as in S3
        Body: text
    };

    // Uploading files to the bucket
    return new Promise((res, rej) => {
        return s3.upload(params, function (err, data) {
            if (err) {
                console.log('error with uploading to s3', err)
                return rej(err)
            } else {
                console.log(`File uploaded successfully. ${data.Location}`);
                return res(data.Location);
            }
        });
    })
}

async function newGame(vip, roomCode, player) {
    console.log('in new game')
    let currentRoom = player.get('currentRoom')
    if (currentRoom && currentRoom != undefined && currentRoom.toUpperCase() !== roomCode.toUpperCase()) {
        return sendSMS(vip, `You are already in game: ${player.get('currentRoom')}. Finish that one before starting another!`);
    }
    let randomName = randomWords(1)[0];
    let timeLimit = 30;
    let players = [{
        number: vip,
        name: randomName,
        order: 1,
        lastResponseRound: 0
    }]
    await dynamoClient.putRoom({
        roomCode: roomCode.toUpperCase(), vip, startTime: new Date(), timeLimit, currentRound: 0, players
    })
    await dynamoClient.updatePlayer({
        number: vip,
        roomHistory: { $add: roomCode.toUpperCase() },
        currentRoom: roomCode.toUpperCase()
    })
    await dynamoClient.putStory({
        roomCode: roomCode.toUpperCase(),
        starter: vip
    })
    return sendSMS(vip, `Welcome! Invite friends:\n\nJoin my Story Buider game! Text 'Join, ${roomCode.toUpperCase()}' ` +
        `to ${process.env.TWILIO_NUMBER}\n\n` +
        `Your name is ${randomName}. Change your name by responding with: 'Name, my cool name'.\n\n` +
        `When all players have joined, respond 'Ready'.`);
    // start listening for join sqs events
    // return invokeLambda(roomCode.toUpperCase(), players, 0)
}

function makeid(length) {
    var result = '';
    var characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    var charactersLength = characters.length;
    for (var i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
}

async function ready(event) {
    let vip = event.From;
    console.log('getting player')
    let player = await dynamoClient.getPlayer({ number: vip });
    console.log('player here', player)
    if (!player) {
        return welcome(vip);
    }
    let currentRoom = player.get('currentRoom').toUpperCase();
    let room = await dynamoClient.getRoom(currentRoom);
    let isReady = room.get('isReady');
    let roomVip = room.get('vip');
    if (vip !== roomVip && !isReady) {
        return sendSMS(vip, `You did not start the game ${currentRoom}. The person who started the game ` +
            `must respond with 'Ready' once all players have joined.`)
    } else if (isReady) {
        return response(event);
    } else {
        let roomCode = room.get('roomCode')
        // send SQS so it stops polling for joiners
        return sendSQS({
            roomCode: roomCode.toUpperCase(),
            type: 'join',
            From: vip,
            text: 'ready'
        }, true)
    }
}

async function response(event) {
    // TODO: visibility on queue affects when messages come in. in FIFO, all other messages blocked....
    //  so, it says game has begun. I text response. Hit's messages. 5 minutes later hit's poller. That's with 5 min
    //  visibility timeout and 1 minute lambda timeout.
    // TODO: disable multiple responses before end of round.
    // TODO: do something with a response between NEW GAME and READY
    console.log('in response')
    // TODO: restrict response character length in case of copy-paste abuse and polly costs
    let { Body, From } = event;
    const player = await dynamoClient.getPlayer({ number: From });
    let roomCode = player.get('currentRoom').toUpperCase();
    console.log('got room code', roomCode)
    return sendSQS({
        Body, From, roomCode, type: 'response', text: Body
    }, false)
}

async function setName(name, From) {
    console.log('changing name')
    const player = await dynamoClient.getPlayer({ number: From });
    if (!player) {
        return welcome(From);
    }
    const room = await dynamoClient.getRoom(player.get('currentRoom'));
    console.log('room ', room);
    let oldPlayers = room.get('players');
    let updatedPlayers = oldPlayers.map(player => {
        if (player.number === From) {
            return {
                ...player,
                name
            }
        } else return player
    })
    await dynamoClient.updateRoom({
        roomCode: room.get('roomCode').toUpperCase(), startTime: room.get('startTime'),
        players: updatedPlayers
    })
    return sendSMS(From, `Hello ${name}.`);
}

async function join(roomCode, From) {
    //  TODO: if the game has already started
    console.log('in join');
    let room = await dynamoClient.getRoom(roomCode.toUpperCase());
    let player = await dynamoClient.getPlayer({ number: From });
    let currentRoom = player.get('currentRoom');
    if (currentRoom && currentRoom.toUpperCase() !== roomCode.toUpperCase()) {
        return sendSMS(From, `You are still in a game: ${player.get('currentRoom')}. ` +
            `Finish that one before joining a new one!`);
    }
    let players = room.get('players');
    console.log('players in the room', players)
    if (players.find(player => player.number === From) != undefined) {
        let player = players.find(player => player.number === From);
        return sendSMS(From, `Hello ${player.get('name')}, you have already joined this game!`)
    } else {
        let randomName = randomWords(1)[0];
        await dynamoClient.updatePlayer({
            number: From,
            currentRoom: roomCode.toUpperCase(),
            roomHistory: { $add: roomCode.toUpperCase() }
        })
        await dynamoClient.putStory({
            roomCode: roomCode.toUpperCase(),
            starter: From
        })
        // send sqs message to update the players object in the room so the order is correct, and no
        //  concurrency issues
        return sendSQS({
            roomCode: roomCode.toUpperCase(),
            From,
            randomName,
            type: 'join',
            text: 'join'
        }, true)
    }
}

async function sendSMS(to, body) {
    console.log('in sms sending')
    return client.messages
        .create({ body, from: process.env.TWILIO_NUMBER, to })
        .then(message => {
            console.log('sent success ', message)
            return Promise.resolve(message)
        })
        .catch(err => {
            console.log(err);
            return Promise.reject(err)
        })
}

// this isn't used, because texts are sent from the poller.
// async function sendSMSResponse(recipient, message) {
//     // https://www.twilio.com/docs/sms/send-messages
//     const response = new MessagingResponse();
//     return response.message({
//         to: recipient,
//         from: process.env.TWILIO_NUMBER
//     }, message).toString();
// }
// after receiving message and updating non-shared DB, send SQS messages
async function sendSQS(data, isJoin) {
    console.log('sending sqs. data and isJoin', data, isJoin);
    // send messages to the queue
    return new Promise((res, rej) => {
        sqs.sendMessage({
            // messages in same group will wait until each other is processed. Doesn't matter
            //  as much for the responses. But does for join.
            MessageBody: JSON.stringify(data),
            // huge issue from this: https://stackoverflow.com/questions/49647566/amazon-aws-sqs-fifo-queue-sendmessage-issue
            // if content based dedup isn't on the queue, this is required. one of them is required.
            MessageDeduplicationId: `m-${data.roomCode}-${data.From}-${data.text}`,
            MessageGroupId: `${data.roomCode}${isJoin ? '' : `-${data.From}`}`,
            QueueUrl: process.env.MESSAGES_QUEUE_URL
        }).promise()
            .then(result => {
                console.log('sent sqs ', result);
                return res(result)
            })
            .catch(err => {
                console.log('sqs send error ', err);
                return rej(err)
            })
    })
}

// on Ready and SNS, invoke the poller lambda
async function invokeLambda(roomCode, players, timeLimit) {
    var params = {
        FunctionName: POLLER_LAMBDA,
        InvocationType: 'Event',
        Payload: JSON.stringify({
            roomCode: roomCode.toUpperCase(),
            players,
            timeLimit
        })
    };
    console.log(params.Payload);

    return new Promise((res, rej) => {
        lambda.invoke(params, function (err, data) {
            if (err) {
                // context.fail(err);
                console.log('failed invoke', err);
                return rej(err);
            } else {
                // Event invocation types makes it async. No payload response.
                // context.succeed('Poller said ' + data.Payload);
                console.log('success invoke', data);
                return res('Poller said ' + data.Payload)
            }
        })
    })
}

module.exports = {
    main
}