const dynamo = require('dynamodb');
// https://www.npmjs.com/package/dynamodb
// const Joi = require('@hapi/joi');
const Joi = require('joi');

export async function getPlayer(params) {
    return new Promise((res, rej) => {
        return Player.get(params.number, {ConsistentRead: true}, (err, player) => {
            if (err) {
                console.log('Error putting player ' + params.number);
                return rej(err)
            } else {
                console.log('Put player ' + params.number);
                return res(player);
            }
        })
    })
}

export async function putPlayer(params) {
    return new Promise((res, rej) => {
        Player.create(params, (err, player) => {
            if (err) {
                console.log('Error putting player ' + params.number);
                return rej(err)
            } else {
                console.log('Put player ' + params.number);
                return res(player);
            }
        })
    })
}

export async function updatePlayer(params) {
    return new Promise((res, rej) => {
        Player.update(params, (err, player) => {
            if (err) {
                console.log('Error putting player ' + params.number);
                return rej(err)
            } else {
                console.log('Put player ' + params.number);
                return res(player);
            }
        })
    })
}

export async function getStory(params) {
    return new Promise((res, rej) => {
        Story.get(params.roomCode, params.starter, { ConsistentRead: true }, (err, story) => {
            if(err) return rej(story)
            return res(story);
        });
    })
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
    return new Promise((res, rej) => {
        return Story.query(params.roomCode)
            .loadAll()
            .exec((err, stories) => {
                if (err) return rej(err)
                return res(stories.Items)
            })     
    })
}

export async function putStory(params) {
    return new Promise((res, rej) => {
        return Story.create(params, (err, story) => {
            if (err) return rej(err)
            return res(story)
        })
    })
}

export async function updateStory(params) {
    return new Promise((res, rej) => {
        return Story.update(params, (err, story) => {
            if (err) return rej(err)
            return res(story)
        })
    })
}

export async function getRoom(roomCode) {
    return new Promise((res, rej) => {
        return Room
            .query(roomCode.toUpperCase())
            .descending()
            .exec((err, rooms) => {
                if (err) return rej(err)
                let sorted = rooms.Items.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
                return res(sorted[0])
            })
    })
}

export async function putRoom(params) {
    return new Promise((res, rej) => {
        return Room.create(params, (err, room) => {
            if (err) return rej(err)
            return res(room);
        })
    })
}

export async function updateRoom(params) {
    return new Promise((res, rej) => {
        return Room.update(params, (err, room) => {
            if (err) return rej(err)
            return res(room);
        })
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
    schema: Joi.object({
        number: Joi.string(),
        currentRoom: Joi.string(),
        roomHistory: dynamo.types.stringSet(),
        lastResponse: Joi.string()
    }),
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
                order: Joi.number(),
                lastResponseRound: Joi.number(),
                lastResponse: Joi.string()
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