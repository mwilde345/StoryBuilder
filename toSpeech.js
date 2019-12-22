// https://stackoverflow.com/questions/56071239/save-aws-polly-mp3-file-to-s3
'use strict';
// Load the SDK
const AWS = require('aws-sdk')
const Fs = require('fs')

// Create an Polly client
const Polly = new AWS.Polly({
    signatureVersion: 'v4',
    region: 'us-east-1'
})

const names = ['Aditi','Amy','Astrid','Bianca','Brian','Camila','Carla','Carmen','Celine','Chantal','Conchita','Cristiano','Dora','Emma','Enrique','Ewa','Filiz','Geraint','Giorgio','Gwyneth','Hans','Ines','Ivy','Jacek','Jan','Joanna','Joey','Justin','Karl','Kendra','Kimberly','Lea','Liv','Lotte','Lucia','Lupe','Mads','Maja','Marlene','Mathieu','Matthew','Maxim','Mia','Miguel','Mizuki','Naja','Nicole','Penelope','Raveena','Ricardo','Ruben','Russell','Salli','Seoyeon','Takumi','Tatyana','Vicki','Vitoria','Zeina','Zhiy']

export default async function main(text, number, roomCode) {
    let name = names[Math.floor(Math.random() * names.length)];
    let params = {
        // TODO: try ssml!
        'Text': text,
        'OutputFormat': 'mp3',
        'VoiceId': name,
        OutputS3BucketName: process.env.S3_BUCKET,
        OutputS3KeyPrefix: `${roomCode}/voice/${number.replace('+','')}`,
        SnsTopicArn: process.env.SNS_TOPIC_ARN
    }

    return Polly.startSpeechSynthesisTask(params, (err, data) => {
       console.log('done');
       return Promise.resolve(data)
    })
}

