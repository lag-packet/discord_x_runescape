const fs = require("fs");
const http = require("http");
const https = require("https");
const crypto = require("crypto");
const {client_id, client_secret, bot_token} = require('./auth/credentials.json');

const server = http.createServer();
const port = 3000;

const all_sessions = [];

server.on("listening", listen_handler);
server.listen(port);
function listen_handler(){
	console.log(`Now Listening on Port ${port}`);
}

server.on('request', request_handler);
function request_handler(req, res) {
  console.log(`New Request from ${req.socket.remoteAddress} for ${req.url} method ${req.method}`);
  if (req.url === "/"){
    const form = fs.createReadStream("html/index.html");
		res.writeHead(200, {"Content-Type": "text/html"})
		form.pipe(res);
  }
  else if (req.url.startsWith('/get_stats')) {
    const user_input = new URL(req.url, `https://${req.headers.host}`).searchParams;
    const runescape_search = user_input.get('runescape_search');
    const info_type = user_input.get('info_type');
    console.log(`Making search for ${runescape_search} with info type ${info_type}`);
    if (runescape_search == null || runescape_search === "" || info_type == null || info_type === "") {
      not_found(res);
      return;
    }
    const state = crypto.randomBytes(20).toString("hex");
    all_sessions.push({runescape_search, info_type, state});
    redirect_discord_auth(state, res);
  }

  else if (req.url.startsWith('/auth_endpoint')) {
    const user_input = new URL(req.url, `https://${req.headers.host}`).searchParams;
    const code = user_input.get('code');
    const state = user_input.get('state');
    let session = all_sessions.find(session => session.state === state);
      
    if(code === undefined || state === undefined || session === undefined){
      not_found(res);
      return;
    }
    const {runescape_search, info_type} = session; // for debug
    //not_found(res);
    send_access_token_request(code, session, user_input, res);
  } else {
    not_found(res);
  }
}

function process_stream (stream, callback , ...args){
  let body = "";
	stream.on("data", chunk => body += chunk);
	stream.on("end", () => callback(body, ...args));
}

function not_found(res) {
	res.writeHead(404, {"Content-Type": "text/html"});
	res.end(`<h1>404 Not Found</h1>`);
}

function redirect_discord_auth(state, res) {
  //only one instance of where this is relied on.
  const disc_auth_url = `https://discord.com/api/oauth2/authorize?client_id=${client_id}&permissions=3072&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fauth_endpoint&response_type=code&scope=identify%20bot%20guilds&state=${state}`;
  res.writeHead(302, {Location: `${disc_auth_url}`})
  .end();
}

function send_access_token_request(code, session, user_input, res) {
	const token_endpoint = "https://discord.com/api/oauth2/token";
	let post_data = new URLSearchParams({client_id, client_secret, code, grant_type:"authorization_code", redirect_uri:"http://localhost:3000/auth_endpoint"}).toString();
	let options = {
		method: "POST",
		headers:{
			"Content-Type":"application/x-www-form-urlencoded"
		}
	}
	const token_req = https.request(
		token_endpoint, 
		options, 
		(token_stream) => process_stream(token_stream, receive_access_token, user_input, session, res) // Add session here?
	).end(post_data);
  console.log("API B: Makes req");
}

function receive_access_token(body, user_input, session, res){
	const {access_token} = JSON.parse(body); // First instance of acesstoken, from this body you can get expires_in for future caching.
  //console.log(body); 
  console.log(`$received access token ${access_token}`);
  get_runescape_information(user_input, access_token, session, res);
}

function get_runescape_information(user_input, access_token, session, res) {
  const {runescape_search, info_type} = session;
  const runescape_url = "https://secure.runescape.com";
  let runescape_endpoint = ''
  if (info_type === 'high_score') {
    runescape_endpoint = `${runescape_url}/m=hiscore_oldschool/index_lite.ws?player=${runescape_search}`;

    //check cache
    const user_cache_file = `./rs_cache/${runescape_search}.json`;
		let cache_valid = false;

		if (fs.existsSync(user_cache_file)) {
      cache_valid = true;
		}
		if (cache_valid) {
      cached_high_score_object = require(user_cache_file);
      console.log('`````````````USER CACHE`````````');
			const first_row = cached_high_score_object.split('\n')[0]; // Split string on newline characters and get the first row (rank/level/total xp)
      console.log(`FIRST IS: ${first_row}`);
			console.log("Cache exists and is valid");
      const rs_arr = first_row.split(','); // Split first row string on commas to create an array
      send_get_discord_channels(session, user_input, rs_arr, access_token, res);
		} else {
      console.log("CACHE NOT !!!!!!!!!!!");
      const runescape_highscores_request = https.request(runescape_endpoint);
      runescape_highscores_request.on(`response`, stream => process_stream(stream, receive_rs_highscores, session, user_input, access_token, res)).end();
      runescape_highscores_request.on('error', (error) => console.log(error));
      console.log("API A: Makes req");
		}
  } else {
    // Item lookup need item IDS!
    // TODO
    res.writeHead(404, {"Content-Type": "text/html"});
    res.end(`<h1>Item lookup to be implemented.</h1>`);
  }
}

function receive_rs_highscores(body, session, user_input, access_token, res) {
  const first_row = body.split('\n')[0]; // Split string on newline characters and get the first row (rank/level/total xp)
  const rs_arr = first_row.split(','); // Split first row string on commas to create an array
  create_runescape_highscore_cache(body, session);
  send_get_discord_channels(session, user_input, rs_arr, access_token, res);
}

function create_runescape_highscore_cache(body, session) {
  console.log();
  console.log(`=============== CREATING RS CACHE=========`);
  fs.writeFile(`./rs_cache/${session.runescape_search}.json`, JSON.stringify(body), ()=> console.log("Access Token Cached")); // Fix might be its not JSON

}

function send_get_discord_channels(session, user_input, rs_arr, access_token, res) {
  const guild_id = user_input.get('guild_id');
  const disc_api_endpoint = 'https://discord.com/api/v10/';
  const channels_endpoint = `${disc_api_endpoint}guilds/${guild_id}/channels`;

  // First request to get channels.
  const options = {
    method:'GET',
    headers: {
      'Authorization': `Bot ${bot_token}`
    }
  }
  // because .get() automatically closes no need to .end() here
  channel_request = https.request(
    channels_endpoint, options, (stream) => process_stream(stream, create_message_discord, session, user_input, rs_arr, guild_id, res)
    ).end();
  console.log("API B: Makes req to get disc channels .get()");
}

function create_message_discord(body, session, user_input, rs_arr, guild_id, res) {
  const body_JSON = JSON.parse(body);
  console.log(`body of JSON: ${body_JSON}`);
  const message = `User ${session.runescape_search} is rank ${rs_arr[0]} with level ${rs_arr[1]} and total xp ${rs_arr[2]}`;
  const target_channel = body_JSON.find(channel => channel.name === "general");  // Find the channel with the name "general"
  
  // If the channel was found, log its ID
  if (target_channel) {
    console.log(`sending to channel id ${target_channel.id}`);
  } else {
    console.log("Channel not found");
  }
  const disc_msg_url = `https://discord.com/api/v10/channels/${target_channel.id}/messages`;
  const options = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bot ${bot_token}`
    }
  }
  const post_data = JSON.stringify({
    "content": message
  });
  const disc_create_message_request = https.request(
    disc_msg_url, options, (stream) => process_stream(stream, redirect_discord_done, session, target_channel, guild_id, res)
    ).end(post_data);
    console.log("API B: Makes req to create channel message.");
}

function redirect_discord_done(body, session, target_channel, guild_id, res) {
  console.log(`In redirect_discord_done full process complete.`);
  redirect_discord_channel = `https://discord.com/channels/${guild_id}/${target_channel.id}`;
  res.writeHead(302, {Location: `${redirect_discord_channel}`}).end();
}
