var aws = require('aws-sdk')
  , Q = require('q') 
  , request = require('request')
  , zlib = require('zlib');

//loggly url, token and tag configuration
//user need to edit while uploading code via blueprint
var logglyConfiguration = {
  url : 'http://logs-01.loggly.com/bulk',
  tags : 'cloudwatch2loggly'
};


//To setup your encrypted Loggly Customer Token inside the script use the following steps 
//1. Create a KMS key - http://docs.aws.amazon.com/kms/latest/developerguide/create-keys.html
//2. Encrypt the Loggly Customer Token using the AWS CLI
//        aws kms encrypt --key-id alias/<your KMS key arn> --plaintext "<your loggly customer token>"
//3. Copy the base-64 encoded, encrypted token from step 2's CLI output (CiphertextBlob attribute) and replace it with the
// "your KMS encypted key" below in line no 22


var encryptedLogglyToken = "your KMS encypted key";
var encryptedLogglyTokenBuffer = new Buffer(encryptedLogglyToken, "base64");

var cloudWatchLogs = new aws.CloudWatchLogs({
    apiVersion : '2014-03-28'
});

var kms = new aws.KMS({
    apiVersion : '2014-11-01'
});

//entry point
exports.handler = function (event, context) {
  
  var parsedEvents = [];
  var totalLogs = 0;

  decryptLogglyToken().then(function(){
    sendEvents(event).then(function(){
      context.succeed('all events are sent to Loggly');
    }, function(){
      context.done();  
    });  
  }, function(){
    context.done();
  })

  //decrypts your Loggly Token from your KMS key
  function decryptLogglyToken(){
    return Q.Promise(function (resolve, reject) {
      var params = {
        CiphertextBlob: encryptedLogglyTokenBuffer
      };
      kms.decrypt(params, function(error, data){
        if(error){
          console.log(error);
          reject();
        }
        else{
          logglyConfiguration.customerToken = data.Plaintext.toString('ascii');
          resolve();
        }
      });
    });
  }
  
  function sendEvents(event){
    return Q.Promise(function (resolve, reject) {
      var parseEventPromises = [];
      var payload = new Buffer(event.awslogs.data, 'base64');
      
      zlib.gunzip(payload, function (error, result) {
        if (error) {
          context.fail(error);
          reject();
        } else {
          var result_o = JSON.parse(result.toString('ascii'));
          totalLogs = result_o.logEvents.length;

          for (var i = 0; i < result_o.logEvents.length; i++) {
            var parseEventPromise = parseEvent(result_o.logEvents[i], result_o.logGroup, result_o.logStream);
            parseEventPromises.push(parseEventPromise);
          }
          Q.allSettled(parseEventPromises).then(function () {
            resolve();
          }, function () {
            reject();
          });
        }
      });
    });
  }
  
  //converts the event to a valid JSON object with the sufficient infomation required
  function parseEvent(event, logGroupName, logStreamName) {
  
    return Q.Promise(function (resolve, reject) {
      var eventData = {
        //remove '\n' character in the last of the event
        'message' : event.message.substring(0, event.message.length - 1),
        'logGroupName' : logGroupName,
        'logStreamName' : logStreamName,
        'timestamp' : new Date(event.timestamp).toISOString(),
      };
  
      parsedEvents.push(eventData);
      
      //let us wait for the all events to get added
      //to the parseEvents array. Then we will send them to Loggly in one go
      if(parsedEvents.length == totalLogs){
        postEventToLoggly().then(function () {
          resolve();
        }, function () {
          reject();
        });
      }
      else{
        resolve();
      }
    });
  }
  
  //joins all the events to a single event
  //and sends to Loggly using bulk end point
  function postEventToLoggly() {
    return Q.promise(function (resolve, reject) {
  
      //get all the events, stringify them and join them
      //with the new line character which can be sent to Loggly
      //via bulk endpoint
      var finalEvent = parsedEvents.map(JSON.stringify).join('\n');
  
      //empty the main events array immediately
      parsedEvents.length = 0;
  
      //creating logglyURL at runtime, so that user can change the tag or customer token in the go
      //by modifying the current script
      var logglyURL = logglyConfiguration.url + '/' + logglyConfiguration.customerToken + '/tag/' + encodeURIComponent(logglyConfiguration.tags);
  
      //create request options to send logs
      try {
        var requestOptions = {
          uri : logglyURL,
          method : 'POST',
          headers : {}
        };
        requestOptions.body = finalEvent;
  
        //now send the logs to Loggly
        request(requestOptions, function (err, response, body) {
          if (err) {
            console.log('Error while uploading events to Loggly');
            reject();
          } else {
            resolve();
          }
        });
  
      } catch (ex) {
        console.log(ex.message);
        reject();
      }
    });
  }
};


