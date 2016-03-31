/** 
 * To setup your encrypted Loggly Customer Token inside the script use the following steps 
 * 1. Create a KMS key - http://docs.aws.amazon.com/kms/latest/developerguide/create-keys.html
 * 2. Encrypt the Loggly Customer Token using the AWS CLI
 *        aws kms encrypt --key-id alias/<your KMS key arn> --plaintext "<your loggly customer token>"
 * 3. Copy the base-64 encoded, encrypted token from step 2's CLI output (CiphertextBlob attribute) and 
 *    paste it in place of the 'your KMS encypted key' below in line 27
 */

var AWS = require('aws-sdk'),
    http = require('http'),
    zlib = require('zlib');

// loggly url, token and tag configuration
// user need to edit while uploading code via blueprint
var logglyConfiguration = {
    hostName: 'logs-01.loggly.com',
    tags: 'CloudWatch2Loggly'
};

var cloudWatchLogs = new AWS.CloudWatchLogs({
    apiVersion: '2014-03-28'
});

// use KMS to decrypt customer token
var decryptParams = {
    CiphertextBlob: new Buffer('your KMS encypted key', 'base64')
};

var kms = new AWS.KMS({
    apiVersion: '2014-11-01'
});

kms.decrypt(decryptParams, function (error, data) {
    if (error) {
        logglyConfiguration.tokenInitError = error;
        console.log(error);
    } else {
        logglyConfiguration.customerToken = data.Plaintext.toString('ascii');
    }
});

// entry point
exports.handler = function (event, context) {
    var payload = new Buffer(event.awslogs.data, 'base64');

    zlib.gunzip(payload, function (error, result) {
        if (error) {
            context.fail(error);
        } else {
            var result_parsed = JSON.parse(result.toString('ascii'));
            var parsedEvents = result_parsed.logEvents.map(function(logEvent) {
                return parseEvent(logEvent, result_parsed.logGroup, result_parsed.logStream);
            });

            postEventsToLoggly(parsedEvents);
        }
    });

    // converts the event to a valid JSON object with the sufficient infomation required
    function parseEvent(logEvent, logGroupName, logStreamName) {
        return {
            // remove '\n' character at the end of the event
            message: logEvent.message.substring(0, logEvent.message.length - 1),
            logGroupName: logGroupName,
            logStreamName: logStreamName,
            timestamp: new Date(logEvent.timestamp).toISOString()
        };
    }

    // joins all the events to a single event
    // and sends to Loggly using bulk endpoint
    function postEventsToLoggly(parsedEvents) {
        if (!logglyConfiguration.customerToken) {
            if (logglyConfiguration.tokenInitError) {
                console.log('error in decrypt the token. Not retrying.');
                return context.fail(logglyConfiguration.tokenInitError);
            }
            console.log('Cannot flush logs since authentication token has not been initialized yet. Trying again in 100 ms.');
            setTimeout(function () { postEventsToLoggly(parsedEvents) }, 100);
            return;
        }

        // get all the events, stringify them and join them
        // with the new line character which can be sent to Loggly
        // via bulk endpoint
        var finalEvent = parsedEvents.map(JSON.stringify).join('\n');

        // creating logglyURL at runtime, so that user can change the tag or customer token in the go
        // by modifying the current script
        // create request options to send logs
        try {
            var options = {
                hostname: logglyConfiguration.hostName,
                path: '/bulk/' + logglyConfiguration.customerToken + '/tag/' + encodeURIComponent(logglyConfiguration.tags),
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': finalEvent.length
                }
            };

            var req = http.request(options, function (res) {
                res.on('data', function (result) {
                    result = JSON.parse(result.toString());
                    if (result.response === 'ok') {
                        context.succeed('all events are sent to Loggly');
                    } else {
                        console.log(result.response);
                    }
                });
                res.on('end', function () {
                    console.log('No more data in response.');
                    context.done();
                });
            });

            req.on('error', function (e) {
                console.log('problem with request: ' + e.toString());
                context.fail(e);
            });

            // write data to request body
            req.write(finalEvent);
            req.end();

        } catch (ex) {
            console.log(ex.message);
            context.fail(ex.message);
        }
    }
};
