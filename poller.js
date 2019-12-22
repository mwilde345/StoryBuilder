const AWS = require('aws-sdk');
const lambda = new AWS.Lambda();
const { Consumer } = require('sqs-consumer');
const snsTopic = process.env.SNS_TOPIC;
const snsArn = process.env.SNS_TOPIC_ARN;
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = require('twilio')(accountSid, authToken);
const dynamoClient = require('./dynamo');

async function main(event, context) {
    const roomCode = event.roomCode;

    const app = Consumer.create({
        queueUrl: process.env.MESSAGES_QUEUE_URL,
        handleMessage: async (message) => {
            // check if it's for our room
            // if it is, handle it, then check if it was the last one
            // if it was the last one, send sns
            let shouldHandle = message.roomCode === roomCode;
            if (shouldHandle) {
                if (message.type === 'response') {
                    roomMessages.push(message);
                    let shouldStop = (new Date() >= end) || (roomMessages.length === event.players.length)
                    if (shouldStop) {
                        app.stop();
                        await handleMessages(roomMessages, event.players, roomCode);
                        return sendSNS(roomCode)
                    }
                } else if (message.type === 'join') {
                    let { From, randomName } = message;
                    const room = await dynamoClient.getRoom(roomCode);
                    const players = room.get('players')
                    const vip = room.get('vip');
                    if (From===vip) {
                        app.stop();
                        await dynamoClient.updateRoom({
                            isReady: true
                        });
                        return Promise.resolve();
                    } else {
                        await dynamoClient.updateRoom({
                            roomCode,
                            players: {
                                $add: {
                                    number: From,
                                    name: randomName
                                }
                            }
                        })
                        await sendSMS(`${From} has joined as ${randomName}!`, vip);
                        return Promise.resolve();
                    }
                } else {
                    return Promise.reject('Bad message type');
                }
            } else {
                return Promise.reject('Message not for given room:' + roomCode);
            }
        }
    });

    app.on('error', (err) => {
        console.error(err.message);
    });

    app.on('processing_error', (err) => {
        console.error(err.message);
    });

    app.on('message_received', (message) => {
        // what data does this event give?
    })
    app.start();
};

// players: [{number: 123, name: asdf, order: 1}] from rooms object
// roomMessages: [{twilio message}]
async function handleMessages(roomMessages, players, roomCode) {
    let playerCount = players.length;
    let stories = await dynamoClient.getStoriesForRoom({ roomCode });
    let updatedStories = [];
    // auto-generate responses for left out players
    let latePlayers = players.filter(player => {
        return !(roomMessages.map(message => message.From).includes(player.number))
    })
    latePlayers.forEach(player => {
        // autoFill late players
        roomMessages.push({
            From: player.number,
            Body: 'Auto generated text.'
        })
    })
    await roomMessages.forEach(async (message) => {
        // find out which texts go where and send them
        let currentPlayer = players.find(player => player.number === message.From);
        let nextPlayer = players.find(player => player.order === (currentPlayer.order + 1) % playerCount);
        let currentStory = stories.find(story => story.get('starter') === message.From);
        let updatedStory = await dynamoClient.updateStory({
            roomCode: currentStory.roomCode,
            starter: currentStory.starter,
            text: { $add: message.Body }
        });
        updatedStories.push(updatedStory);
        return sendSMS(message.Body, nextPlayer.number);
    })
    // sendSNS that round is over.
    return sendSNS(roomCode, updatedStories);
}

async function sendSMS(body, to) {
    return client.messages
        .create({ body, from: process.env.TWILIO_NUMBER, to })
        .then(message => {
            return Promise.resolve()
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
    return publishTextPromise.then(
        function (data) {
            console.log(`Message ${params.Message} send sent to the topic ${params.TopicArn}`);
            console.log("MessageID is " + data.MessageId);
            return Promise.resolve()
        }).catch(
            function (err) {
                console.error(err, err.stack);
                return Promise.reject()
            });
}

module.exports = {
    main
}