const EventEmitter = require('events').EventEmitter;
const Gpio = require('onoff').Gpio;
const http = require('http');
const fork = require('child_process').fork;
const path = require('path');

class RotaryEncoder extends EventEmitter {
	constructor({a,b,toggle, inc}) {
		super();
		this.inc = inc;
		this.gpioA = new Gpio(a, 'in', 'both');
		this.gpioB = new Gpio(b, 'in', 'both');
		this.gpioToggle = new Gpio(toggle, 'in', 'rising', { debounceTimeout: 10 });
		this.gpioA.watch((err, value) => {
			if (err) {
				this.emit('error', err);
				return;
			}
			const a = value;

			try {
				const b = this.gpioB.readSync();
				if (a === b) {
					this.emit('rotation', this.inc);
				} else {
					this.emit('rotation', -this.inc);
				}
			} catch (ex) {
				this.emit('error', ex);
			}
		});
		this.gpioToggle.watch((err, value) => {
			if (err) {
				this.emit('error', err);
				return;
			}
			this.emit('toggle');
		});
	}
}

class HueAPI {
	constructor(bridge, user) {
		this.bridge = bridge;
		this.user = user;
	}
	getGroup(groupId) {
		return this._httpGet('/groups/' + groupId);
	}
	putGroup(groupId, data) {
		return this._httpPut('/groups/' + groupId + '/action', data);
	}
	_httpGet(path) {
		return new Promise((resolve, reject) => {
			http.get({
				host: this.bridge,
				port: 80,
				path: '/api/' + this.user + path
			}, res => {
				res.setEncoding('utf8');
				let body = '';
				res.on('data', data => {
					body += data;
				});
				res.on('end', () => {
					let parsed; 
					try {
						parsed = JSON.parse(body);
					} catch (ex) {
					}
					resolve({ statusCode: res.statusCode, body: parsed || body});
				});
			}).on('error', (e) => {
				reject(e);
			});
		});
	}
	_httpPut(path, data) {
		return new Promise((resolve, reject) => {
			const req = http.request({
				host: this.bridge,
				port: 80,
				method: 'PUT',
				path: '/api/' + this.user + path,
				headers: { 'Content-Type': 'application/json' }
			}, res => {
				res.setEncoding('utf8');
				let body = '';
				res.on('data', data => {
					body += data;
				});
				res.on('end', () => {
					let parsed; 
					try {
						parsed = JSON.parse(body);
					} catch (ex) {
					}
					resolve({ statusCode: res.statusCode, body: parsed || body});
				});
			});
			req.on('error', (e) => {
				reject(e);
			});
			req.write(JSON.stringify(data));
			req.end();
		});
	}
}

function throttlePromise(fn,{ debounce, delay } = { debounce: 0, delay: 0}) {
	let running = false;
	let waiting = false;
	let start = Date.now();
	let lastArgs = null;
	let lastThis = null;
	const completed = function() {
		if (lastArgs != null) {
			const nextArgs = lastArgs;
			const nextThis = lastThis;
			lastArgs = null;
			lastThis = null;
			throttled.apply(nextThis, nextArgs);
		}
	};
	const throttled = function(...args) {
		if (running || waiting) {
			if (debounce && (Date.now() - start < debounce)) {
				return;
			}
			lastThis = this;
			lastArgs = args;
			return;
		}
		start = Date.now();
		running = true;
		if (delay) {
			waiting = true;
			const t = setTimeout(() => {
				waiting = false;
				if (!running) {
					completed();
				}
			}, delay);
		}
		fn.apply(this, args).then((response) => {
			running = false;
			if (!waiting) {
				completed();
			}
		}).catch((e) => {
			running = false;
			if (!waiting) {
				completed();
			}
		});
	};
	return throttled;
}

function updateUI(groupId, api, worker) {
	return api.getGroup(groupId).then(({ statusCode, body}) => {
		worker.send(body);
		return {statusCode, body};
	});
}

const BRIDGE = '192.168.0.4';
const USER_ID = 'O7nK3Cv1WUSGeOtiuzWbPCsxbjxCdIwmRFWPo72Z';
const GROUP_ID = 8;
const api = new HueAPI(BRIDGE, USER_ID);
const uiWorker = fork(path.resolve('worker.js'), [], {
	stdio: ['pipe', 'pipe', 'pipe', 'ipc']
});
uiWorker.on('exit', code => {
	console.log('UI worker closed with code ' + code);
});
uiWorker.stdout.on('data', (data) => {
	console.log(data.toString('utf8'));
});
uiWorker.stderr.on('data', (data) => {
	console.log(data.toString('utf8'));
});

const updateGroupUI = updateUI.bind(this, GROUP_ID, api, uiWorker);

updateGroupUI().then(({body}) => {
	console.log(body);
	let on = body.action.on;
	const encoder = new RotaryEncoder({
		a: 17,
		b: 18,
		toggle: 27, 
		inc: 32
	});
	encoder.on('rotation', throttlePromise((value) => {
		return api.putGroup(GROUP_ID, {
			bri_inc: value
		}).then(response => {
			console.log(response.body);
			updateGroupUI();
		});
	}, {debounce: 100, delay: 500}));
	encoder.on('toggle', throttlePromise(() => {
		on = !on;
		return api.putGroup(GROUP_ID, {
			on: on
		}).then(response => {
			console.log(response.body);
			return updateGroupUI();
		});
	}));
});