const dynamo = require('dynamodb');
https://www.npmjs.com/package/dynamodb
const Joi = require('@hapi/joi');

export async function getPlayer(params) {
    return Player.query(params.number)
        .exec();
}

export async function putPlayer(params) {
    Player.create(params, (err) => {
        if (err) {
            console.log('Error putting player ' + params.number);
            return Promise.reject(err)
        } else {
            console.log('Put player ' + params.number);
            return Promise.resolve(params.number);
        }
    })
}

export async function updatePlayer(params) {
    Player.update(params, (err, player) => {
        return Promise.resolve(player);
    })
}

export async function getStory(params) {
    Story.get(roomCode, starter, { ConsistentRead: true }, (err, story) => {
        return Promise.resolve(story);
    });
    // Account.get('test@example.com', {ConsistentRead: true, AttributesToGet : ['name','age']}, function (err, acc) {
    //     console.log('got account', acc.get('email'))
    //     console.log(acc.get('name'));
    //     console.log(acc.get('age'));
    //     console.log(acc.get('email')); // prints null
    //   });
    // BlogPost
    //   .query('werner@example.com')
    //   .where('title').equals('Expanding')
    //   .exec();
}

export async function getStoriesForRoom(params) {
    return Story.query(params.roomCode)
        .loadAll()
        .exec((err, stories) => {
            return Promise.resolve(stories)
        })
}

export async function putStory(params) {
    return Story.create(params, (err, story) => {
        return Promise.resolve(story)
    })
}

export async function updateStory(params) {
    return Story.update(params, (err, story) => {
        return Promise.resolve(story)
    })
}

export async function getRoom(params) {
    return Room
        .query(roomCode)
        .descending()
        .exec((rooms) => {
            let sorted = rooms.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
            return Promise.resolve(sorted[0])
        })
}

export async function putRoom(params) {
    return Room.create(params, (err, room) => {
        return Promise.resolve(room);
    })
}

export async function updateRoom(params) {
    return Room.update(params, (err, room) => {
        return Promise.resolve(room);
    })
    // Account.update({ email: 'foo@example.com', age: { $add: 1 } }, function (err, acc) {
    //     console.log('incremented age by 1', acc.get('age'));
    // });

    // BlogPost.update({
    //     email: 'werner@example.com',
    //     title: 'Expanding the Cloud',
    //     tags: { $add: 'cloud' }
    // }, function (err, post) {
    //     console.log('added single tag to blog post', post.get('tags'));
    // });
}

export const Player = dynamo.define('Player', {
    hashKey: 'number',
    timestamps: true,
    schema: {
        number: Joi.string(),
        currentRoom: Joi.string(),
        roomHistory: dynamo.types.stringSet(),
        lastResponse: Joi.string()
    },
    tableName: process.env.PLAYERS_DB
})

export const Room = dynamo.define('Room', {
    hashKey: 'roomCode',
    rangeKey: 'startTime',
    timestamps: true,
    schema: {
        roomCode: Joi.string(),
        startTime: Joi.date(),
        vip: Joi.string(),
        timeLimit: Joi.number(),
        currentRound: Joi.number(),
        players: Joi.array().items(
            Joi.object({
                number: Joi.string(),
                name: Joi.string(),
                order: Joi.number()
            })),
        isReady: Joi.boolean()
    },
    tableName: process.env.ROOMS_DB
})

export const Story = dynamo.define('Story', {
    hashKey: 'roomCode',
    rangeKey: 'starter',
    timestamps: true,
    schema: {
        roomCode: Joi.string(),
        starter: Joi.string(),
        s3Link: Joi.string(),
        text: Joi.string()
    },
    tableName: process.env.STORIES_DB
})