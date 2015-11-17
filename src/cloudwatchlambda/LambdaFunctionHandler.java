package cloudwatchlambda;

import java.io.InputStream;
import java.util.Properties;

import com.amazonaws.services.lambda.runtime.Context;
import com.amazonaws.services.lambda.runtime.RequestHandler;

public class LambdaFunctionHandler implements RequestHandler<Object, Object> {

    @Override
    public Object handleRequest(Object input, Context context) {
        context.getLogger().log("Input: " + input);

        main(null);
        
        return null;
    }
    
    public static void main(String args[])
    {
    	try
    	{
    		InputStream fileInput = LambdaFunctionHandler.class.getClassLoader().getResourceAsStream("config.properties");
    		Properties prop = new Properties();
    		prop.load(fileInput);
    		fileInput.close();
    		
    		String SecretKey = prop.getProperty("AWS_SECRETKEY");
    		String AccessKeyId = prop.getProperty("AWS_ACCESSKEYID");
    		String LogglyToken = prop.getProperty("LOGGLY_TOKEN");
    		String LogglyTags = prop.getProperty("LOGGLY_TAG"); 
    		
    		LogEventConsumer lec = new LogEventConsumer();
    		lec.invokeService(SecretKey, AccessKeyId, LogglyToken, LogglyTags);
    	}
    	catch(Exception ex)
    	{
		ex.printStackTrace();
    	}
    }
}
