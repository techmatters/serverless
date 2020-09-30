exports.handler = async function(context, event, callback) {
    console.log("Hello");
    console.log(event);
	const response = new Twilio.Response();
    response.appendHeader('Access-Control-Allow-Origin', '*');
    response.appendHeader('Content-Type', 'application/json');
    response.appendHeader('Access-Control-Allow-Headers', 'Content-Type');
    const client = context.getTwilioClient();
    let channel = await client.taskrouter.workspaces(event.workspaceSid)
        .workers(event.workerSid)
        .workerChannels(event.workerChannels)
        .fetch();
    if(event.increasing === true){
        if(channel['availableCapacityPercentage'] === 0){
            if(channel['configuredCapacity'] < event.workerLimit){
                let update = await client.taskrouter.workspaces(event.workspaceSid)
                                    .workers(event.workerSid)
                                    .workerChannels(event.workerChannels)
                                    .update({capacity: channel['configuredCapacity'] + 1});
            }
        }
    } else {
        console.log("Hello");
        let decreased = 1;
        if(channel['configuredCapacity'] - 1 >= 1){
            decreased = channel['configuredCapacity'] - 1;
            let update = await client.taskrouter.workspaces(event.workspaceSid)
                                    .workers(event.workerSid)
                                    .workerChannels(event.workerChannels)
                                    .update({capacity: decreased});
            console.log(update['configuredCapacity']);
        }
        
    }
    
    callback(null,response);
};