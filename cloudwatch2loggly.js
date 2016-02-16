var aws = require('aws-sdk')
  , Q = require('q') 
  , request = require('request')
  , zlib = require('zlib');

//loggly url, token and tag configuration
//user need to edit while uploading code via blueprint
var logglyConfiguration = {
  url : 'http://logs-01.loggly.com/bulk',
  customerToken : 'xxxxxx',
  tags : 'cloudwatch2loggly'
};

var cloudWatchLogs = new aws.CloudWatchLogs({
    apiVersion : '2014-03-28'
});

//entry point
exports.handler = function (event, context) {
  
  var parsedEvents = [];
  var totalLogs = 0;

  sendEvents(event).then(function(){
    context.succeed('all events are sent to Loggly');
  }, function(){
    context.done();
  });
  
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


