# StoryBuilder
Story builder group game via SMS

* Person texts game number
* New session, give them a game code
* Alert VIP when new people join. vip can ask for all numbers, gets a list to start new group message. along with sample message text (welcome, etc)
* Users text game number with code to join. Game asks them for a name
* When ready, VIP says start.
* New group message with everyone, listing players and instructions.
* Each player starts their story (theme?)
* Limit to response? time,length?
* Once every player has responded to every other story-starter, finish
* Send group text with everyone's name or a bunch of links? (must be formatted). Or a webpage with all the links
* You can listen and vote from text. (twilio doesn't accept messages from group text?
* After voting, send group text message with link to save the recording to google drive. VIP gets the data to paste into the group message.

Doesn't look like twilio does group sms: https://stackoverflow.com/questions/26690403/twilio-sms-facilitating-a-group-sms

any way to start a new group text? send all the numbers to VIP and have them start it? shortcut to send to all those numbers? start from email? 

in a group setting maybe everyone gets a different persons story to read.

add random music behind the polly audio.

## Dev
Make sure to `source .env` when invoking local.

drop any messages from an unknown number not in a conversation. It will join the conversation if it does `start game` or `join game <code>`.

followed this: https://www.twilio.com/docs/sms/tutorials/how-to-receive-and-reply-python-amazon-lambda. TODO: matchup serverless config with what they say there. see this: https://serverless.com/framework/docs/providers/aws/events/apigateway/#lambda-integration
api gateway needs permissions to write to cloudwatch. add that role somewhere?

Cookies are really weird. Need to parse them in API Gateway because it's between lambda and twilio. So edit that model in the integration response in apigw. idk.

## DB
StoriesDB:
* roomCode: PK
* s3link
* text
* starter: SK

PlayersDB:
* number: PK
* currentRoom
* lastResponseTime ?
* roomHistory
* lastResponse
* lastResponseRound ?

RoomsDB:
* roomCode: PK
* vip
* startTime: SK
* timeLimit
* currentRound
* players

## SQS:
https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html

visibility timeout.
Imagine 5 concurrent games all fighting over the same queue before time limit runs out. can they sort out each other's messages? Use 0 second visibility timeout because non-matching rooms will be re-queued. Hopefully the right room catches it next....... Or the right room will find it concurrently and ack it while the other room at the same time will ignore it and put it back on the queue....

If the right room finds the message, but it has already collected it in its cache, or it finds a message in the wrong round, then delete the message.