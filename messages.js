'use strict';
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;

const MessagingResponse = require('twilio').twiml.MessagingResponse;
const dynamo = require('dynamodb');
const AWS = require('aws-sdk');
const lambda = new AWS.Lambda();
const POLLER_LAMBDA = process.env.POLLER_LAMBDA
const SQSProducer = require('sqs-producer');
// create simple producer
const producer = SQSProducer.create({
    queueUrl: process.env.MESSAGES_QUEUE_URL
});


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
        if (record.EventSubscriptionArn.includes(process.env.ROUND_SNS_TOPIC)) {
            endRound();
        } else if (record.EventSubscriptionArn.includes(process.env.VOICE_SNS_TOPIC)) {
            voice();
        }

    } else if ("SmsMessageSid" in event) {
        // it's from twilio

    }
}

async function voice() {
    
}

async function endRound() {

}

async function newGame() {

}

async function response() {

}

async function join() {

}

async function sendSMS(recipient, message) {
    // https://www.twilio.com/docs/sms/send-messages
    const response = new MessagingResponse();
    return response.message({
        to: recipient,
        from: '+14352105245'
    }, message).toString();
}
// after receiving message and updating non-shared DB, send SQS messages
async function sendSQS(data) {
    // send messages to the queue
    producer.send([data], function (err) {
        if (err) console.log(err);
    });
}

// on Ready and SNS, invoke the poller lambda
async function invokeLambda() {

    var params = {
        FunctionName: POLLER_LAMBDA,
        InvocationType: 'Event',
        Payload: `{ "roomCode" : "${roomCode}" }`
    };

    lambda.invoke(params, function (err, data) {
        if (err) {
            context.fail(err);
        } else {
            // Event invocation types makes it async. No payload response.
            context.succeed('Lambda_B said ' + data.Payload);
        }
    })
}

module.exports = {
    main
}