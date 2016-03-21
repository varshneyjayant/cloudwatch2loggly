//To setup your encrypted Loggly Customer Token inside the script use the following steps 
//1. Create a KMS key - http://docs.aws.amazon.com/kms/latest/developerguide/create-keys.html
//2. Encrypt the Loggly Customer Token using the AWS CLI
//        aws kms encrypt --key-id alias/<your KMS key arn> --plaintext "<your loggly customer token>"
//3. Copy the base-64 encoded, encrypted token from step 2's CLI output (CiphertextBlob attribute) and replace it with the
// "your KMS encypted key" below in line no 19

var aws = require('aws-sdk'),
  http = require('http'),
  zlib = require('zlib');

//loggly url, token and tag configuration
//user need to edit while uploading code via blueprint
var logglyConfiguration = {
  hostName: 'logs-01.loggly.com',
  tags: 'CloudWatch2Loggly'
};

var encryptedLogglyToken = "your KMS encypted key";
var encryptedLogglyTokenBuffer = new Buffer(encryptedLogglyToken, "base64");

var cloudWatchLogs = new aws.CloudWatchLogs({
  apiVersion: '2014-03-28'
});

var kms = new aws.KMS({
  apiVersion: '2014-11-01'
});

//entry point
exports.handler = function (event, context) {
  
  var parsedEvents = [];
  var totalLogs = 0;

  var decryptLogglyToken = function () {
    var params = {
      CiphertextBlob: encryptedLogglyTokenBuffer
    };
    kms.decrypt(params, function (error, data) {
      if (error) {
        logglyConfiguration.tokenInitError = error;
        console.log(error);
      } else {
        logglyConfiguration.customerToken = data.Plaintext.toString('ascii');
      }
    });
  }();

  var sendEvents = function (eventData) {
    var payload = new Buffer(eventData.awslogs.data, 'base64');

    zlib.gunzip(payload, function (error, result) {
      if (error) {
        context.fail(error);
        reject();
      } else {
        var result_o = JSON.parse(result.toString('ascii'));
        totalLogs = result_o.logEvents.length;

        for (var i = 0; i < result_o.logEvents.length; i++) {
          parseEvent(result_o.logEvents[i], result_o.logGroup, result_o.logStream);
        }
      }
    });
  }(event);

  //converts the event to a valid JSON object with the sufficient infomation required
  function parseEvent(event, logGroupName, logStreamName) {
    var eventData = {
      //remove '\n' character in the last of the event
      'message': event.message.substring(0, event.message.length - 1),
      'logGroupName': logGroupName,
      'logStreamName': logStreamName,
      'timestamp': new Date(event.timestamp).toISOString()
    };

    parsedEvents.push(eventData);

    //let us wait for the all events to get added
    //to the parseEvents array. Then we will send them to Loggly in one go
    if (parsedEvents.length === totalLogs) {
      postEventToLoggly();
    }
  }

  //joins all the events to a single event
  //and sends to Loggly using bulk end point

  function postEventToLoggly(callback) {
    if (!logglyConfiguration.customerToken) {
      if (logglyConfiguration.tokenInitError) {
        console.log('error in decrypt the token. Not retrying.');
        return;
      }
      console.log('Cannot flush logs since authentication token has not been initialized yet. Trying again in 100 ms.');
      setTimeout(function () {
        postEventToLoggly(callback);
      }, 100);
      return;
    }

    //get all the events, stringify them and join them
    //with the new line character which can be sent to Loggly
    //via bulk endpoint
    var finalEvent = parsedEvents.map(JSON.stringify).join('\n');

    //empty the main events array immediately
    parsedEvents.length = 0;

    //creating logglyURL at runtime, so that user can change the tag or customer token in the go
    //by modifying the current script
    //create request options to send logs
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
            context.done();
            console.log(result.response);
          }

          if (typeof callback !== 'undefined') {
            callback();
          }
        });
        res.on('end', function () {
          console.log('No more data in response.');
        });
      });

      req.on('error', function (e) {
        console.log('problem with request: ' + e.toString());
      });

      // write data to request body
      req.write(finalEvent);
      req.end();

    } catch (ex) {
      console.log(ex.message);
      reject();
    }
  }
};
