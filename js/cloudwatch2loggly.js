var aws = require('aws-sdk')
    , Q = require('q')
    , request = require('request');

//AWS keys configuration
//user need to edit while uploading code via blueprint
var awsConfiguration = {
    accessKeyId     : 'xxxxx',
    secretAccessKey : 'xxxxxx',
    region          : 'xxxxx'
};

//loggly url, token and tag configuration
//user need to edit while uploading code via blueprint
var logglyConfiguration = {
    url            : 'http://logs-01.loggly.com/bulk',
    customerToken   : 'xxxxxx',
    tags            : 'cloudwatch2loggly'
};

//setup keys in the aws object
aws.config.update({
    accessKeyId     : awsConfiguration.accessKeyId,
    secretAccessKey : awsConfiguration.secretAccessKey,
    region          : awsConfiguration.region
});


var cloudWatchLogs = new aws.CloudWatchLogs({
    apiVersion: '2014-03-28'
});


var nowDate = new Date();

//time upto which we want to fetch logs
var logEndTime = nowDate.getTime();

//time from which we want to fetch logs
var logStartTime = new Date(logEndTime - (5 * 60 * 1000)).getTime();
var parsedEvents = [];

//entry point
exports.handler = function(event, context) {
    
    //initiate the script here
    getLogGroupsFromAWSCloudwatch().then(function() {
        sendRemainingEvents().then(function(){
            context.done();
        }, function(){
            context.done();    
        });
    }, function() {
        
    });
};

//retreives all the log groups present in the cloudwatch
function getLogGroupsFromAWSCloudwatch(){
    var logStreamPromises = [];
    
    return Q.Promise(function(resolve, reject){
        var getLogGroups = function(nextToken){
            
            var logGroupParams = {};
            
            
            //log groups exceeds the count from 50, then next token should
            //present to get the logs from next page
            if(nextToken){
                logGroupParams.nextToken = nextToken;
            }
            
            
            cloudWatchLogs.describeLogGroups(logGroupParams, function(err, result){
                if(err){
                    console.log(err, err.stack);
                    resolve();
                }
                else{
                    for(var count = 0; count < result.logGroups.length; count++){
                        var logStreamPromise = fetchLogsStreamsFromLogGroup(result.logGroups[count].logGroupName);
                        logStreamPromises.push(logStreamPromise);
                    }
                    
                    if(result.nextToken){
                        getLogGroups(result.nextToken);
                    }
                    else{
                        Q.allSettled(logStreamPromises).then(function() {
                            resolve();
                        }, function() {
                            reject();
                        });
                    }
                }
            });
        }
        getLogGroups();
    });
}


//retrieves all the logstreams for a particular log group
function fetchLogsStreamsFromLogGroup(logGroupName) {
    var logEventPromises = [];
    return Q.Promise(function(resolve, reject){
        function getLogStreams(logGroupName, nextToken){
            var logStreamParams = {
                descending : true,
                logGroupName : logGroupName
            };
            
            if(nextToken){
                logStreamParams.nextToken = nextToken;
            }
            
            cloudWatchLogs.describeLogStreams(logStreamParams, function(err, result) {
                if(err){
                    console.log(err, err.stack);
                    resolve();
                }     
                else{
                    for(var count = 0; count < result.logStreams.length; count++){
                        var logEventPromise = fetchEventsFromLogStream(logGroupName, result.logStreams[count].logStreamName);
                        logEventPromises.push(logEventPromise);
                    }
                    
                    if(result.nextToken){
                        getLogStreams(logGroupName, result.nextToken);
                    }
                    else{
                        Q.allSettled(logEventPromises).then(function() {
                            resolve();
                        }, function() {
                            reject();
                        });
                    }
                }
            });
        };
        getLogStreams(logGroupName);
    });
}


//retireves all the log events for a particular logstream inside a loggroup
function fetchEventsFromLogStream(logGroupName, logStreamName){
    var eventLogglyPromises = [];
    
    return Q.Promise(function(resolve, reject) {
        
        function getEvents(logGroupName, logStreamName){
                    
            //parameters to filter events
            var eventParams = {
                logGroupName : logGroupName,
                logStreamName : logStreamName,
                endTime : logEndTime,
                startTime : logStartTime,
                startFromHead : true
            };
            
            cloudWatchLogs.getLogEvents(eventParams, function(err, result){
                if(err){
                    console.log(err, err.stack);
                    resolve();
                }
                else{
                    for(var count = 0; count < result.events.length; count++){
                        var event = result.events[count];
                        var eventLogglyPromise = parseEvent(event, logGroupName, logStreamName);
                        eventLogglyPromises.push(eventLogglyPromise);
                    }
                    Q.allSettled(eventLogglyPromises).then(function() {
                        resolve();
                    }, function() {
                        reject();
                    });
                }
            });
        }
        getEvents(logGroupName, logStreamName);
    });
}

//converts the event to a valid JSON object with the sufficient infomation required
function parseEvent(event, logGroupName, logStreamName){
    
    return Q.Promise(function(resolve, reject) {
        var eventData = {
                              //remove '\n' character in the last of the event
            'message'       : event.message.substring(0,event.message.length-1),
            'logGroupName'  : logGroupName,
            'logStreamName' : logStreamName,
            'timestamp'     : new Date(event.timestamp).toISOString(),
            'ingestionTime' : new Date(event.ingestionTime).toGMTString(),
        };
        
        postEventToLoggly(eventData).then(function(){
            resolve();
        }, function(){
            reject();
        });
        
    });
}

//uploads the events to Loggly
//we will hold the events in an array until they reaches to 100
//then set the count of zero. 
function postEventToLoggly(event){
    
    return Q.promise(function(resolve, reject){
        if(parsedEvents.length == 100){
            upload().then(function(){
                resolve();
            }, function(){
                reject();
            });
        }
        else{
            parsedEvents.push(event);
            resolve();
        }
    });
}

//checks if any more events are left
//after sending events in multiples of 100
function sendRemainingEvents(){
    return Q.promise(function(resolve, reject){
        if(parsedEvents.length > 0){
            upload().then(function(){
                resolve();
            }, function(){
                reject(); 
            });
        }
        else{
            resolve();
        }
    });
}

function upload(){
    return Q.promise(function(resolve, reject){
        
        //get all the events, stringify them and join them
        //with the new line character which can be sent to Loggly
        //via bulk endpoint
        var finalEvent = parsedEvents.map(JSON.stringify).join('\n');
        
        //empty the main events array immediately to hold new events
        parsedEvents.length = 0;

        //creating logglyURL at runtime, so that user can change the tag or customer token in the go
        //by modifying the current script
        var logglyURL = logglyConfiguration.url + '/' + logglyConfiguration.customerToken + '/tag/' + logglyConfiguration.tags;

        //create request options to send logs
        try{
            var requestOptions = {
                uri     : logglyURL,
                method  : 'POST',
                headers : {}
            };

            requestOptions.body = finalEvent;

            //now send the logs to Loggly
            request(requestOptions, function(err, response, body){
                if(err){
                    console.log('Error while uploading events to Loggly');
                    reject();
                }
                else{
                    resolve();
                }
            });

        }
        catch(ex){
            console.log(ex.message);
            reject();
        }
    });
}
