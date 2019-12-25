const AWS = require('aws-sdk');
const { Consumer } = require('sqs-consumer');
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = require('twilio')(accountSid, authToken);
const dynamoClient = require('./dynamo');
const sqs = new AWS.SQS({ apiVersion: '2012-11-05' })
const randomWords = require('random-words');

async function main(event, context) {
    console.log('in poller', event);
    if ("Records" in event) {
        let messages = event.Records;
        await asyncForEach(messages, async record => {
            console.log('doing record ', record)
            let receiptHandle = record.receiptHandle;
            console.log('body here ', record.body);
            let body = JSON.parse(record.body);
            console.log('parsed ', body);
            let { roomCode, From, type } = body;
            let room = await dynamoClient.getRoom(roomCode);
            if (!room) {
                return Promise.resolve(deleteMessage(receiptHandle));
            }
            console.log('room', room)
            let randomName = randomWords(1)[0];
            if (type === 'response') {
                console.log('its a response')
                let players = room.get('players');
                let currentPlayer = players.find(player => player.number === From);
                if (currentPlayer.lastResponseRound === room.get('currentRound')) {
                    sendSMS(`You've already responded for this round.\nPlease wait for everyone to finish their response.`,
                        From);
                } else {
                    let updatedRoom = await handleResponse(room, From, body.Body.replace(/\+/gi, ' '));
                    console.log('players ', updatedRoom.get('players'));
                    let playersRemaining = updatedRoom.get('players').filter(player => {
                        return (player.lastResponseRound < room.get('currentRound'));
                    })
                    console.log('filtered ', playersRemaining);
                    console.log('length: ', playersRemaining.length)
                    if (!playersRemaining || playersRemaining.length === 0) {
                        await handleEndOfRound(updatedRoom);
                    }
                }
                return Promise.resolve(deleteMessage(receiptHandle));
            } else if (type === 'join') {
                console.log('in join')
                const vip = room.get('vip');
                if (From === vip) {
                    console.log('it from vip')
                    let snsResult = await sendSNS(roomCode, []);
                    console.log('sns res ', snsResult);
                    return Promise.resolve(deleteMessage(receiptHandle));
                } else {
                    console.log('updating room')
                    let updatedPlayers = room.get('players');
                    let newPlayer = {
                        number: From,
                        name: randomName,
                        order: room.get('players').length + 1,
                        lastResponseRound: room.get('currentRound')
                    }
                    updatedPlayers.push(newPlayer)
                    await sendSMS(`You joined the game! Your name is ${randomName}. Change your name ` +
                        `by responding with Name, my cool name.\n\n Number of current players: ${updatedPlayers.length}.\n\n` +
                        `Waiting on ${vip} to get started.`, From)
                    let updatedRoom = await dynamoClient.updateRoom({
                        roomCode,
                        startTime: room.get('startTime'),
                        players: updatedPlayers
                    })
                    console.log('updated room ', updatedRoom)
                    await sendSMS(`${From} has joined as ${randomName}!`, vip);
                    console.log('sent sms')
                }
                console.log('deleting message');
                return Promise.resolve(deleteMessage(receiptHandle));
            } else {
                return Promise.reject('Bad message type');
            }
        })

    } else {
        return Promise.reject('invalid message ', event);
    }
}

async function deleteMessage(id) {
    console.log('deleting sqs message ', id)
    var params = {
        QueueUrl: process.env.MESSAGES_QUEUE_URL,
        ReceiptHandle: id
    };
    return new Promise((res, rej) => {
        sqs.deleteMessage(params, function (err, data) {
            if (err) return rej(err, err.stack); // an error occurred
            else {
                console.log('deleted sqs message');
                return res(data)
            }
        });
    })
}

async function handleResponse(room, From, Body) {
    console.log('in handleResponse')
    let roomCode = room.get('roomCode');
    let players = room.get('players');
    console.log('roomCode and players', roomCode, players)
    let updatedPlayers = players.map(player => {
        if (player.number === From) {
            return {
                ...player,
                lastResponseRound: room.get('currentRound'),
                lastResponse: Body
            }
        } else return player
    })
    console.log('updating room')
    let updatedRoom = await dynamoClient.updateRoom({ roomCode, players: updatedPlayers, startTime: room.get('startTime') });
    console.log('updated room ', updatedRoom);
    return updatedRoom;
}

async function handleEndOfRound(room) {
    console.log('in handle end of round')
    let roomCode = room.get('roomCode');
    let stories = await dynamoClient.getStoriesForRoom({ roomCode: roomCode.toUpperCase() });
    console.log('stories ', stories)
    let updatedStories = [];
    let players = room.get('players');
    let playerCount = players.length;
    //  TODO: auto-generate responses for left out players
    console.log('about to loop players')
    await asyncForEach(players, async player => {
        console.log('looping players', player)
        let nextPlayer = players.find(nestedPlayer => nestedPlayer.order
            === (1 + (player.order % playerCount)));
        console.log('next player ', nextPlayer);
        let orderNum1 = player.order - (player.lastResponseRound - 1);
        let orderNum2 = player.order;
        if (orderNum1 > 0) {
            orderNum2 = orderNum1;
        } else if (orderNum1 === 0) {
            orderNum2 = playerCount;
        } else if (orderNum1 < 0) {
            orderNum2 = playerCount + orderNum1
        }
        let currentStoryOwner = players.find(nestedPlayer => nestedPlayer.order
            === orderNum2)
        let currentStory = stories.find(story => story.get('starter') === currentStoryOwner.number);
        console.log('current story', currentStory)
        let updatedStory = await dynamoClient.updateStory({
            roomCode: currentStory.get('roomCode'),
            starter: currentStory.get('starter'),
            text: unescape(currentStory.get('text') ? currentStory.get('text') + '\n' + player.lastResponse : player.lastResponse)
                .replace(/\+/gi,' ')
        });
        console.log('updated story', updatedStory)
        updatedStories.push(updatedStory)
        if (nextPlayer && nextPlayer.number) {
            await sendSMS(`${player.name} said:\n"${player.lastResponse}"`, nextPlayer.number);
        }
    })
    console.log('done looping players');
    // sendSNS that round is over.
    return sendSNS(roomCode, updatedStories);
}

async function asyncForEach(array, callback) {
    for (let index = 0; index < array.length; index++) {
        await callback(array[index], index, array);
    }
}

async function sendSMS(body, to) {
    console.log('in sms sending poller', body, to)
    return client.messages
        .create({ body: unescape(body), from: process.env.TWILIO_NUMBER, to })
        .then(message => {
            console.log('sent success ', message)
            return Promise.resolve(message)
        })
        .catch(err => {
            console.log(err);
            return Promise.reject(err)
        })
}

async function sendSNS(roomCode, updatedStories) {
    let params = {
        Message: JSON.stringify({
            roomCode,
            updatedStories
        }),
        TopicArn: process.env.SNS_TOPIC_ARN
    }
    return new Promise((res, rej) => {
        return new AWS.SNS({ apiVersion: '2010-03-31' }).publish(params).promise()
        .then(
            function (data) {
                console.log(`Message ${params.Message} send sent to the topic ${params.TopicArn}`);
                console.log("MessageID is " + data.MessageId);
                return res(data)
            }).catch(
                function (err) {
                    console.error(err, err.stack);
                    return rej(err)
                });

    })
}

module.exports = {
    main
}