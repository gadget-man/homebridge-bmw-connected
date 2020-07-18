var request = require("request");
var requestretry = require('requestretry');
var Service, Characteristic;

module.exports = function(homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;

  homebridge.registerAccessory("homebridge-bmw-connected", "BMWConnected", BMWConnected);
}

function BMWConnected(log, config) {
  this.log = log;
	this.name = config["name"];
	this.vin = config["vin"];
  this.username = config["username"];
	this.password = config["password"];
	this.client_id = config["client_id"];
  this.currentState = Characteristic.LockCurrentState.SECURED;

  this.refreshToken = "";
	this.refreshtime = 0;
	this.authToken = "";
	this.lastUpdate = 0;

  this.service = new Service.LockMechanism(this.name);

  this.service
    .getCharacteristic(Characteristic.LockCurrentState)
    .on('get', this.getState.bind(this));

  this.service
    .getCharacteristic(Characteristic.LockTargetState)
    .on('get', this.getState.bind(this))
    .on('set', this.setState.bind(this));

    this.getState(function(err,state){
  		if (err){
  			if (err){this.log("Auth Error: " + err + "Check your creds")}
  			this.log('stateRequest error');
  			this.log("Current lock state is " + ((this.currentState == Characteristic.LockTargetState.SECURED) ? "locked" : "unlocked"));
  		}else{

        var currentState = (state == Characteristic.LockTargetState.SECURED) ?
          Characteristic.LockCurrentState.SECURED : Characteristic.LockCurrentState.UNSECURED;

        this.service
          .setCharacteristic(Characteristic.LockCurrentState, currentState);

  			this.log("Current lock state is " + ((this.currentState == Characteristic.LockTargetState.SECURED) ? "locked" : "unlocked"));
  		}
  	}.bind(this))

}

BMWConnected.prototype.getState = function(callback) {
  this.log("Getting current state...");
  this.getauth(function(err){
    if (err) {
      callback(err,this.currentState);
    }

  request.get({
    url: 'https://www.bmw-connecteddrive.co.uk/api/vehicle/dynamic/v1/' + this.vin,
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 11_1_1 like Mac OS X) AppleWebKit/604.3.5 (KHTML, like Gecko) Version/11.0 Mobile/15B150 Safari/604.1',
      'Authorization': 'Bearer ' + this.authToken,
    },
  }, function(err, response, body) {

    if (!err && response.statusCode == 200) {
      var json = JSON.parse(body);
      this.log(json["attributesMap"]["door_lock_state"]);
      var state = (json["attributesMap"]["door_lock_state"] == "LOCKED" || json["attributesMap"]["door_lock_state"] == "SECURED") ? Characteristic.LockCurrentState.SECURED  : Characteristic.LockCurrentState.UNSECURED;;
      //var state = json.state; // "lock" or "unlock"
      callback(null, state); // success
    }
    else {
      callback( new Error(response.statusCode),this.currentState);
      this.log(' ERROR REQUEST RESULTS:', err, response.statusCode, body);
    }
  }.bind(this));
}.bind(this));
}

BMWConnected.prototype.getExecution = function(callback) {
  this.log("Waiting for confirmation...");
  this.getauth(function(err){
    if (err) {
      callback(err,this.currentState);
    }

  var complete = 0;

  requestretry.get({
    // url: 'https://www.bmw-connecteddrive.co.uk/api/vehicle/remoteservices/v1/' + this.vin + '/state/execution',
    url: 'https://www.bmw-connecteddrive.co.uk/remoteservices/rsapi/v1/' + this.vin + '/state/execution',
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 11_1_1 like Mac OS X) AppleWebKit/604.3.5 (KHTML, like Gecko) Version/11.0 Mobile/15B150 Safari/604.1',
      'Authorization': 'Bearer ' + this.authToken,
      'accept':	'application/json, text/plain, */*',
    },
    // The below parameters are specific to request-retry
    maxAttempts: 20,   // (default) try 10 times
    retryDelay: 2000,  // (default) wait for 5s before trying again
    retryStrategy: myRetryStrategy

  }, function(err, response, body) {

    if (!err && response.statusCode == 200) {
      this.log('Success!');

      callback(null); // success
    }
    else {
      callback( new Error(response.statusCode),this.currentState);
      this.log(' ERROR REQUEST RESULTS:', err, response.statusCode, body);
    }
  }.bind(this));
}.bind(this));
}

function myRetryStrategy(err, response, body){
  // retry the request if we had an error or if the response was a 'Bad Gateway'
  var json = JSON.parse(body);
  var commandtype = (json["remoteServiceType"]);
  var execution = (json["event"]["rsEventStatus"]);

  return err || execution === "PENDING" || execution === "RUNNING"
}


BMWConnected.prototype.setState = function(state, callback) {
  var bmwState = (state == Characteristic.LockTargetState.SECURED) ? "RDL" : "RDU";

  this.log("Sending Command %s", bmwState);
  this.getauth(function(err){
    if (err) {
      callback(err);
    }

    console.log('authtoken', this.authToken)

    var setStateUrl = 'https://www.bmw-connecteddrive.co.uk/remoteservices/rsapi/v1/' + this.vin + '/' + bmwState
    console.log('setStateUrl', setStateUrl)

  request.post({
      // url: 'https://customer.bmwgroup.com/api/vehicle/remoteservices/v1/' + this.vin +'/' + bmwState,
      url: setStateUrl,
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 11_1_1 like Mac OS X) AppleWebKit/604.3.5 (KHTML, like Gecko) Version/11.0 Mobile/15B150 Safari/604.1',
        'Authorization': 'Bearer ' + this.authToken,
        // 'Content-Type': 'application/json'
    },
    json: {
      clientId: 3
    }
  }, function(err, response, body) {

    if (!err && response.statusCode == 200) {
      //this.log('Remote: ' + bmwState);

      // call this.getExecution
      this.getExecution(function(err){
        if (err) {
          callback(err,this.currentState);
        }

      // we succeeded, so update the "current" state as well
      var currentState = (state == Characteristic.LockTargetState.SECURED) ?
        Characteristic.LockCurrentState.SECURED : Characteristic.LockCurrentState.UNSECURED;

      //this.log(currentState);
      this.service
        .setCharacteristic(Characteristic.LockCurrentState, currentState);

      callback(null); // success
    }.bind(this));
    }
    else {
      callback( new Error(response.statusCode));
      console.log(' ERROR REQUEST RESULTS:', err, response.statusCode, body);
    }
  }.bind(this));
}.bind(this));
}

BMWConnected.prototype.getServices = function() {
  return [this.service];
}

BMWConnected.prototype.getauth = function(callback) {
	if (this.needsAuthRefresh() === true) {
		this.log ('Getting Auth Token');
			request.post({
				url: 'https://customer.bmwgroup.com/gcdm/oauth/authenticate',
				headers: {
				'Host':	'customer.bmwgroup.com',
				'Origin':	'https://customer.bmwgroup.com',
				'Accept-Encoding':	'br, gzip, deflate',
				'Content-Type' : 'application/x-www-form-urlencoded',
    		'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 11_1_1 like Mac OS X) AppleWebKit/604.3.5 (KHTML, like Gecko) Version/11.0 Mobile/15B150 Safari/604.1',
				'Origin': 'https://customer.bmwgroup.com',
				//'Authorization': 'Basic ' + this.authbasic,
  			},
				form: {
					'username': this.username,
					'password': this.password,
					'client_id':this.client_id,
					'response_type': 'token',
					'redirect_uri':	'https://www.bmw-connecteddrive.com/app/default/static/external-dispatch.html',
					'scope': 'authenticate_user fupo',
					'state': 'eyJtYXJrZXQiOiJnYiIsImxhbmd1YWdlIjoiZW4iLCJkZXN0aW5hdGlvbiI6ImxhbmRpbmdQYWdlIiwicGFyYW1ldGVycyI6Int9In0',
					'locale': 'GB-en'
				}
			},function(err, response, body) {
				 if (!err && response.statusCode == 302) {
					 //this.log('Auth Success!');
					 var d = new Date();
				   var n = d.getTime();
					 var location = response.headers['location'];
					 //this.log(location);
					 var myURL = require('url').parse(location).hash;
					 //this.log(myURL);
					 var arr = myURL.split("&");
					 this.authToken = arr[1].substr(arr[1].indexOf("=")+1);
					 this.refreshtime = n + arr[3].substr(arr[3].indexOf("=")+1) * 1000;
					 this.log ('Got Auth Token: ' + this.authToken);
					 //this.log('Refreshtime: ' + this.refreshtime);
					 callback(null);
				 }
				 else{
				this.log('Error getting Auth Token');
				 callback(response.statusCode);
			 			}
				}.bind(this)
		);
	}
	else{
		callback(null);
	}
}

BMWConnected.prototype.needsAuthRefresh = function () {
	var currentDate = new Date();
  	var now = currentDate.getTime();
 	//this.log("Now   :" + now);
 	//this.log("Later :" + this.refreshtime);
	if (now > this.refreshtime) {
		return true;
	}
	return false;
}
