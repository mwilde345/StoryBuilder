let rounds = [1,2,3]
let orders = [1,2,3,4];
let playerCount = orders.length;
rounds.forEach(round => {
    let rotated = rotateArray(orders, round - 1);
    orders.forEach(order => {
        let orderNum2 = rotated[order - 1];
        console.log(`Round: ${round},  ${order} -> ${orderNum2}`);
    });
})

function rotateArray(arr, n) {
    let copy = [];
    arr.forEach((x, i) => {
        copy[(i+n) % arr.length] = arr[i];
    })
    return copy;
}

/**
round 1(0), f(0) = x. 1 -> 1
round 2(1), f(x) = y. 1 -> 2
round 3(2), f(f(x)). 1 -> 3
[1,2,3,4]
[3,4,1,2] (round 3)
rotate the array of orders, (round) times. Then the rotatedArray[order - 1] = currStoryOwner.



x -f> y
1 -> (1 + (player.order % playerCount)) -> 2
2 -> 3
3 -> 4
4 -> 1

*/

/**
Round: 1,  1 -> 1
Round: 1,  2 -> 2
Round: 1,  3 -> 3
Round: 1,  4 -> 4
Round: 2,  1 -> 4
Round: 2,  2 -> 1
Round: 2,  3 -> 2
Round: 2,  4 -> 3
Round: 3,  1 -> 1
Round: 3,  2 -> 4
Round: 3,  3 -> 1
Round: 3,  4 -> 2
 */