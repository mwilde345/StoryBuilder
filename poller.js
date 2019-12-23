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

    return new Promise((res, rej) => {
        console.log('in promise')
        if ("Records" in event) {
            let messages = event.Records;
            messages.forEach(async record => {
                console.log('doing record ', record)
                let receiptHandle = record.receiptHandle;
                console.log('body here ', record.body);
                let body = JSON.parse(record.body);
                console.log('parsed ', body);
                let { roomCode, From, type } = body;
                let room = await dynamoClient.getRoom(roomCode);
                console.log('room', room)
                let randomName = randomWords(1)[0];
                if (type === 'response') {
                    let updatedRoom = await handleResponse(room, From, body.Body);
                    let playersRemaining = updatedRoom.get('players').filter(player => {
                        return player.lastResponseRound < room.get('currentRound')
                    })
                    if (!playersRemaining.length) {
                        await handleEndOfRound(room);
                    }
                    res(deleteMessage(receiptHandle));
                } else if (type === 'join') {
                    console.log('in join')
                    const vip = room.get('vip');
                    if (From === vip) {
                        console.log('it from vip')
                        let snsResult = await sendSNS(roomCode, []);
                        console.log('sns res ', snsResult);
                        return res(deleteMessage(receiptHandle));
                    } else {
                        console.log('updating room')
                        let updatedPlayers = room.get('players');
                        updatedPlayers.push({
                            number: From,
                            name: randomName,
                            order: room.get('players').length + 1,
                            lastResponseRound: room.get('currentRound')
                        })
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
                    return res(deleteMessage(receiptHandle));
                } else {
                    return rej('Bad message type');
                }
            })

        } else {
            return rej('invalid message ', event);
        }
    })
}

async function deleteMessage(id) {
    var params = {
        QueueUrl: process.env.MESSAGES_QUEUE_URL,
        ReceiptHandle: id
    };
    return new Promise((res, rej) => {
        sqs.deleteMessage(params, function (err, data) {
            if (err) rej(err, err.stack); // an error occurred
            else res(data)         // successful response
        });
    })
}

async function handleResponse(room, From, Body) {
    let roomCode = room.get('roomCode');
    let players = room.get('players');
    let currentStory = await dynamoClient.getStory({
        roomCode,
    })
    let updatedPlayers = players.map(player => {
        if (player.number === From) {
            return {
                ...player,
                lastResponseRound: room.get('currentRound'),
                lastResponse: Body
            }
        } else return player
    })
    return dynamoClient.updateRoom({ roomCode, players: updatedPlayers, startTime: room.get('startTime') });
}

async function handleEndOfRound(room) {
    let roomCode = room.get('roomCode');
    let stories = await dynamoClient.getStoriesForRoom({ roomCode: roomCode.toUpperCase() });
    let updatedStories = [];
    let playerCount = players.length;
    let players = room.get('players');
    //  TODO: auto-generate responses for left out players
    players.forEach(async player => {
        let nextPlayer = players.find(nestedPlayer => nestedPlayer.order
            === (player.order + 1));
        let currentStoryOwner = players.find(nestedPlayer => nestedPlayer.order
            === (playerCount - Math.abs(player.order - room.get('currentRound'))))
        // todo: wrong
        let currentStory = stories.find(story => story.get('starter') === currentStoryOwner.number);
        let updatedStory = await dynamoClient.updateStory({
            roomCode: currentStory.get('roomCode'),
            starter: currentStory.get('starter'),
            text: currentStory.get('text') + '\n' + player.lastResponse
        });
        updatedStories.push(updatedStory)
        await sendSMS(player.lastResponse, nextPlayer.number);
    })
    // sendSNS that round is over.
    return sendSNS(roomCode, updatedStories);
}

async function sendSMS(body, to) {
    return client.messages
        .create({ body, from: process.env.TWILIO_NUMBER, to })
        .then(message => {
            return Promise.resolve(message)
        });
}

async function sendSNS(roomCode, updatedStories) {
    let params = {
        Message: JSON.stringify({
            roomCode,
            updatedStories
        }),
        TopicArn: process.env.SNS_TOPIC_ARN
    }
    var publishTextPromise = new AWS.SNS({ apiVersion: '2010-03-31' }).publish(params).promise();

    // Handle promise's fulfilled/rejected states
    return new Promise((res, rej) => {
        return publishTextPromise.then(
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