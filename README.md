# Cloudwatch-Loggly
AWS Lambda function retrieve log event from AWS CloudWatch and send Logs to Loggly using REST Endpoint

We can configure the Lambda function using config.properties file
- Loggly Token, Loggly Tags 
- AWS Access Key ID, AWS Secret Key

We have to set Lambda function to execute in every 5 minutes.

Steps:

1. Describe all Log Groups in CloudWatch
2. Iterate over log groups and describe Log Streams
3. Iterate over log streams getting Log Events
4. Build LogEntry string
5. Execute HTTP POST to Loggly REST API
