const dynamo = require('dynamodb');
const AWS = require('aws-sdk');
const lambda = new AWS.Lambda();
const { Consumer } = require('sqs-consumer');
const roundTopic = process.env.ROUND_SNS_TOPIC;

function main(event, context) {
    const roomCode = event.roomCode;

    const app = Consumer.create({
        queueUrl: process.env.MESSAGES_QUEUE_URL,
        handleMessage: async (message) => {
            // do some work with `message`
            
        }
    });

    app.on('error', (err) => {
        console.error(err.message);
    });

    app.on('processing_error', (err) => {
        console.error(err.message);
    });

    app.on('message_received', (message) => {

    })

    app.start();
};

module.exports = {
    main
}