'use strict';
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = require('twilio')(accountSid, authToken);
const dynamoClient = require('./dynamo');
const { toSpeech } = require('./toSpeech');
const s3urls = require('@mapbox/s3urls');
const randomWords = require('random-words');

const MessagingResponse = require('twilio').twiml.MessagingResponse;
const AWS = require('aws-sdk');
const lambda = new AWS.Lambda();
const s3 = new AWS.S3();
const POLLER_LAMBDA = process.env.POLLER_LAMBDA
// const SQSProducer = require('sqs-producer');
const sqs = new AWS.SQS({ apiVersion: '2012-11-05' })
// create simple producer
// const producer = SQSProducer.create({
//     queueUrl: process.env.MESSAGES_QUEUE_URL
// });


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
        let record = event.Records[0];
        if ("roomCode" in record) {
            // it's from the poller
            return endRound(record);
        } else {
            // it's from the voice
            return voice(event);
        }

    } else if ("SmsMessageSid" in event) {
        // TODO: if they are not in Players DB and it doesn't have Join, do nothing, or say 
        //  'Welcome, text New Game'

        // it's from twilio
        let message = event.Body;
        event.From = unescape(event.From);
        message = message.replace('+', ' ');
        console.log('received twilio message ', message);
        let player = await dynamoClient.getPlayer({ number: event.From });
        if (message.toLowerCase().replace(' ', '').trim() === 'newgame') {
            //TODO: if in game, use as response
            let roomCode = makeid(4).toUpperCase();
            if (player == undefined || player == null) {
                player = await dynamoClient.putPlayer({
                    number: event.From,
                    roomHistory: [roomCode],
                })
            }
            return newGame(event.From, roomCode, player);
        }
        else if (message.toLowerCase().replace(' ', '').trim() === 'ready') {
            return ready(event);
        }
        else if (message.toLowerCase().replace(' ', '').trim().startsWith('join')) {
            let roomCode = message.match(/(Join)([,]?)(.*)/i)[3].trim().toUpperCase();
            if (!player || !player.length) {
                await dynamoClient.putPlayer({
                    number: event.From,
                    roomHistory: [roomCode]
                })
            }
            return join(roomCode, event.From);
        }
        else if (message.toLowerCase().replace(' ', '').trim().startsWith('name')) {
            let name = message.match(/(Name,)(.*)/i)[2].trim();
            if (!name || !name.length || name.replace(' ').length == 0) {
                name = randomWords(1)[0];
            }
            return setName(name, event.From);
        }
        else if (!player || !player.length || !(player.get('currentRoom'))) {
            // first-timers or need a new game
            return welcome(event.From)
        } else {
            return response(event);
        }
    }
}

async function welcome(From) {
    return sendSMS(From, `Welcome to Story Builder! Respond with 'New Game' to get started. Or join an existing ` +
        `game with 'Join, ROOM_CODE'.`);
}

async function voice(event) {
    // example URL: https://bucket-name.s3.amazonaws.com/roomCode/voice/1234567.polly-named-file.mp3
    // example outputURI: "s3://story-builder-bucket/roomCode/voice/1234567.polly-named-file.mp3"
    let { outputURI } = event;
    outputURI = outputURI.replace('s3://', '');
    let bucket = outputURI.slice(0, outputURI.indexOf('/'));
    let key = outputURI.slice(outputURI.indexOf('/') + 1, outputURI.length);
    let roomCode = key.match(/(.*?\/)/gi)[0].replace('/', '').toUpperCase();
    let number = '+' + key.match(/([0-9]+\.)/g)[0].replace('.', '');
    let url = s3urls.toUrl(bucket, key);
    const story = await dynamoClient.getStory({ roomCode, starter: number });
    const text = story.get('text');
    const message = `Your story turned out to be: ${text}. Here is the audio! ${url}`;
    return sendSMS(number, message);
    // get the number and roomcode from the s3 object url
    // fetch their story and send it back to them in text, put it on s3,
    // and send a link to the voice in the text.
}

async function endRound(record) {
    // came from the poller via sns
    // iterate round in the room object.
    const roomCode = record.roomCode;
    const stories = record.updatedStories;
    const room = await dynamoClient.getRoom(roomCode);
    const players = room.get('players');
    const currentRound = room.get('currentRound');
    // const stories = await dynamoClient.getStoriesForRoom().filter(story => {
    //     players.map(player => player.number).includes(story.starter);
    // })
    if (currentRound === players.length) {
        // end the game
        // remove currentRoom from all the players
        await players.forEach(async player => {
            let { number } = player;
            // let playerObj = await dynamoClient.getPlayer({ number });
            await dynamoClient.updatePlayer({ number, currentRoom: null });
        })
        // generate voice. Upload it and text to s3. Send the links to each player
        await stories.forEach(async story => {
            const text = story.get('text');
            const starter = story.get('starter');
            await textToS3(text, starter, roomCode.toUpperCase());
            return await toSpeech(text, starter, roomCode.toUpperCase());
            // update s3Link in the 'voice' function
        })
    } else {
        if (currentRound === 0) {
            await players.forEach(async player => {
                await sendSMS(player.number, `The game is starting! Start your story by responding to this message. ` +
                    `Hurry, you have ${room.get('timeLimit')} seconds!`);
            })
        }
        return dynamoClient.updateRoom({
            roomCode, startTime: room.startTime, currentRound: { $add: 1 }, isReady: true
        })
        // return invokeLambda(roomCode.toUpperCase(), players, room.get('timeLimit'))
    }
}

async function textToS3(text, starter, roomCode) {
    const params = {
        Bucket: process.env.S3_BUCKET,
        Key: `${roomCode.toUpperCase()}/text/${starter}.txt`, // File name you want to save as in S3
        Body: text
    };

    // Uploading files to the bucket
    s3.upload(params, function (err, data) {
        if (err) {
            return Promise.reject(err);
        }
        console.log(`File uploaded successfully. ${data.Location}`);
        return Promise.resolve(data.Location);
    });
}

async function newGame(vip, roomCode, player) {
    let currentRoom = player.get('currentRoom')
    if (currentRoom && currentRoom != undefined && currentRoom.toUpperCase() !== roomCode.toUpperCase()) {
        return sendSMS(vip, `You are already in game: ${player.get('currentRoom')}. Finish that one before starting another!`);
    }
    let randomName = randomWords(1)[0];
    let timeLimit = 10;
    let players = [{
        number: vip,
        name: randomName,
        order: 1
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
    console.log('player here',player)
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
        await sendSQS({
            roomCode: roomCode.toUpperCase(),
            type: 'join',
            From: vip
        })
    }
}

async function response(event) {
    console.log('in response')
    // TODO: restrict response character length in case of copy-paste abuse and polly costs
    let { Body, From } = event;
    const player = await dynamoClient.getPlayer({ number: From });
    let roomCode = player.get('currentRoom').toUpperCase();
    return sendSQS({
        Body, From, roomCode, type: 'response'
    })
}

async function setName(name, From) {
    const player = await dynamoClient.getPlayer({ number: From });
    if (!player || !player.length) {
        return welcome(From);
    }
    const room = await dynamoClient.getRoom(player.get('currentRoom'));
    let updatedPlayers = room.get('players').map(player => {
        if (player.number === From) {
            player.name = name
        }
    })
    await dynamoClient.updateRoom({
        roomCode: room.get('roomCode').toUpperCase(), startTime: room.get('startTime'),
        players: updatedPlayers
    })
    return sendSMS(From, `Hello ${name}.`);
}

async function join(roomCode, From) {
    console.log('in join');
    let room = await dynamoClient.getRoom(roomCode.toUpperCase());
    let player = await dynamoClient.getPlayer({ number: From });
    let currentRoom = player.get('currentRoom');
    if (currentRoom && currentRoom.toUpperCase() !== roomCode.toUpperCase()) {
        return sendSMS(From, `You are still in a game: ${player.get('currentRoom')}. ` +
            `Finish that one before joining a new one!`);
    }
    let players = room.get('players');
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
        let player = players.find(player => player.number === From);
        await sendSMS(From, `You joined the game! Your name is ${player.get('name')}. Change your name ` +
            `by responding with Name, my cool name.\n\n Number of current players: ${room.get('players').length + 1}.\n\n`+
            `Waiting on ${room.get('vip')} to get started.`)
        // send sqs message to update the players object in the room so the order is correct, and no
        //  concurrency issues
        return sendSQS({
            roomCode: roomCode.toUpperCase(),
            From,
            randomName,
            type: 'join'
        })
    }
}

async function sendSMS(to, body) {
    return client.messages
        .create({ body, from: process.env.TWILIO_NUMBER, to })
        .then(message => {
            return Promise.resolve()
        });
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
async function sendSQS(data) {
    // send messages to the queue
    return await sqs.sendMessage({
        MessageGroupId: `${data.roomCode}`,
        MessageDeduplicationId: `m-${data.roomCode}-${data.From}`,
        MessageBody: JSON.stringify(data),
        QueueUrl: process.env.MESSAGES_QUEUE_URL
    }).promise()
    // producer.send([{
    //     id: makeid(10),
    //     body: JSON.stringify(data)
    // }], function (err, res) {
    //     if (err) console.log(err);
    //     return Promise.resolve(res)
    // });
}

// on Ready and SNS, invoke the poller lambda
// players [{number: 123, name: asdf, order: 1}]
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