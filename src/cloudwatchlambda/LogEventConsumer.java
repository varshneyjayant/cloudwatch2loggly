package cloudwatchlambda;

import java.io.IOException;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.Date;
import java.util.List;

import com.amazonaws.auth.AWSCredentials;
import com.amazonaws.services.logs.AWSLogs;
import com.amazonaws.services.logs.AWSLogsClient;
import com.amazonaws.services.logs.model.DescribeLogGroupsResult;
import com.amazonaws.services.logs.model.DescribeLogStreamsRequest;
import com.amazonaws.services.logs.model.DescribeLogStreamsResult;
import com.amazonaws.services.logs.model.GetLogEventsRequest;
import com.amazonaws.services.logs.model.GetLogEventsResult;
import com.amazonaws.services.logs.model.OutputLogEvent;
import com.amazonaws.util.json.JSONObject;

/**
 * AWS Lambda Function to retrieve log events from AWS CloudWatch and send to Loggly using the REST endpoint
 * - LOGGLY_API_KEY included in source for demo purposeses but shoud be handled in a secure way
 * - Lambda function is setup to execute every 5 minutes 
 * - Steps
 * - 1. Describe all Log Groups in CloudWatch
 * - 2. Iterate over log groups and describe Log Streams
 * - 3. Iterate over log streams getting Log Events
 * - 4. Build LogEntry string
 * - 5. Execute HTTP GET to Loggly REST API
 * - 6. (Optional) If the GET to Loggly is successful (200) delete LogStream
 * */

public class LogEventConsumer {
	
	private static AWSLogs logsClient;
	static  AWSCredentials credentials;
	private static String LOGGLY_API_KEY;
	
	public static void setAWSCredentials(String SecretKey, String AccessKeyID) throws Exception
	{
		credentials = new AWSCredentials() {
			@Override
			public String getAWSSecretKey() {
				return SecretKey;
			}
			
			@Override
			public String getAWSAccessKeyId() {
				return AccessKeyID;
			}
		};
		
		logsClient = new AWSLogsClient(credentials);
	}
	
	public static void setLogglyConfiguration(String LogglyToken)
	{
		LOGGLY_API_KEY = new String(LogglyToken);
	}
	
	private String getEventTimestamp(Date eventTime)
	{
		ZonedDateTime zonalTime = ZonedDateTime.ofInstant(eventTime.toInstant(),ZoneId.systemDefault());
		return zonalTime.format(DateTimeFormatter.ISO_INSTANT);
	}
	
	public void invokeService(String secretKey, String accessKeyID, String LogglyToken, String LogglyTags) throws IOException
	{
		/**
		 * 
		 * Get log groups 
		 * Get log streams for each log group
		 * Get log events for each log stream
		 * Build log entry
		 * 
		 */
			
		try {
			setAWSCredentials(secretKey, accessKeyID);
			setLogglyConfiguration(LogglyToken);
		} catch (Exception e1) {
			e1.printStackTrace();
		}
				
		DescribeLogGroupsResult describeLogGroupsResult = logsClient.describeLogGroups();
		
		describeLogGroupsResult.getLogGroups().forEach(logGroup -> {
			
			DescribeLogStreamsRequest describeLogStreamsRequest = new DescribeLogStreamsRequest().withLogGroupName(logGroup.getLogGroupName());
			DescribeLogStreamsResult describeLogStreamsResult = logsClient.describeLogStreams(describeLogStreamsRequest);
			describeLogStreamsResult.getLogStreams().forEach(stream -> {
				
				StringBuilder logEntry = new StringBuilder();
				
				GetLogEventsRequest getLogEventsRequest = new GetLogEventsRequest().withStartFromHead(Boolean.TRUE)
						.withLogGroupName(describeLogStreamsRequest.getLogGroupName())
						.withLogStreamName(stream.getLogStreamName());
								
				Date endDate = new Date();
				Date startDate = new Date(endDate.getTime() - (5*60*1000));
				
				getLogEventsRequest.setStartTime(startDate.getTime());
				getLogEventsRequest.setEndTime(endDate.getTime());
				
				while (true) {
					
					GetLogEventsResult getLogEventsResult = logsClient.getLogEvents(getLogEventsRequest);
					List<OutputLogEvent> events = getLogEventsResult.getEvents();
					
					if (events.size() == 0) {
						break;
					}
					
					events.forEach(event -> {
						try {
							
							logEntry.append(new JSONObject().put("timestamp", getEventTimestamp(new Date(event.getTimestamp())))
									.put("logGroupName", describeLogStreamsRequest.getLogGroupName())
									.put("logStreamName", stream.getLogStreamName())
									.put("message", event.getMessage())
									.put("ingestionTime", new Date(event.getIngestionTime()).toString()));
							
						} catch (Exception e) {
							e.printStackTrace();
						}
					});
					
					getLogEventsRequest = new GetLogEventsRequest().withNextToken(getLogEventsResult.getNextForwardToken())
							.withLogGroupName(describeLogStreamsRequest.getLogGroupName())
							.withLogStreamName(stream.getLogStreamName());
						
					getLogEventsResult = logsClient.getLogEvents(getLogEventsRequest);
				}
				
				/**
				 * 
				 * execute the GET to loggly
				 * 
				 */
				
				try {
					HttpURLConnection connection = (HttpURLConnection) new URL("http://logs-01.loggly.com/bulk/"
							.concat(LOGGLY_API_KEY)
							.concat("/tag/")
							.concat(LogglyTags)
							.concat("/")).openConnection();
							
					connection.setRequestMethod("POST");
					connection.setRequestProperty("content-type", "text/plain");
					connection.setDoOutput(true);
				
					byte[] outputInBytes = logEntry.toString().replace("}{", "}"+System.getProperty("line.separator")+"{").getBytes("UTF-8");
					OutputStream os = connection.getOutputStream();
					os.write( outputInBytes );    
					os.close();
					
					connection.connect();
					
					if (connection.getResponseCode() == 200) {
						//DeleteLogStreamRequest deleteLogEventsRequest = new DeleteLogStreamRequest().withLogGroupName(describeLogStreamsRequest.getLogGroupName()).withLogStreamName(stream.getLogStreamName());
						//logsClient.deleteLogStream(deleteLogEventsRequest);
					}
					
				} catch (Exception e) {
					e.printStackTrace();
				}
			});
		});
	}
}
