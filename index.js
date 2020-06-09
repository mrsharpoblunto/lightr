const EventEmitter = require('events').EventEmitter;
const Gpio = require('onoff').Gpio;
const http = require('http');
const fork = require('child_process').fork;
const path = require('path');

class RotaryEncoder extends EventEmitter {
	constructor({a,b,toggle}) {
		super();
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
					this.emit('rotation', 1);
				} else {
					this.emit('rotation', -1);
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

function throttlePromise(fn,{ reduce, debounce, delay } = { reduce: null, debounce: 0, delay: 0}) {
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
			if (reduce && lastArgs) {
				lastArgs = reduce(lastArgs, args);
			} else {
				lastArgs = args;
			}
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

class Worker {
	constructor() {
		this._createWorker();
	}
	_createWorker() {
		this._worker = fork(path.resolve('worker.js'), [], {
			stdio: ['pipe', 'pipe', 'pipe', 'ipc']
		});
		this._worker.stdout.on('data', (data) => {
			console.log(data.toString('utf8'));
		});
		this._worker.stderr.on('data', (data) => {
			console.log(data.toString('utf8'));
		});
		this._worker.on('exit', code => {
			if (code === 1) {
				console.log('Restarting Worker...');
				this._createWorker();
			}
		});
	}
	send(message) {
		this._worker.send(message);
	}
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
const FIELDS = {'bri_inc': 8, 'hue_inc': 1024, 'sat_inc': 8};

const api = new HueAPI(BRIDGE, USER_ID);
const uiWorker = new Worker();
const updateGroupUI = updateUI.bind(this, GROUP_ID, api, uiWorker);

updateGroupUI().then(({body}) => {
	console.log(body);
	let fieldIndex = 0;

	const encoder = new RotaryEncoder({
		a: 17,
		b: 18,
		toggle: 27, 
		inc: 32
	});
	encoder.on('rotation', throttlePromise((value) => {
		const field = Object.keys(FIELDS)[fieldIndex];
		return api.putGroup(GROUP_ID, {
			[field]: FIELDS[field] * value
		}).then(response => {
			console.log(response.body);
			updateGroupUI();
		});
	}, {
		debounce: 100, 
		delay: 500, 
		reduce: (prev, next) => [prev[0] + next[0]]
	}));
	encoder.on('toggle',() => {// throttlePromise(() => {
		fieldIndex++;
		if (fieldIndex >= Object.keys(FIELDS).length) {
			fieldIndex = 0;
		}
		console.log('Selected ' + Object.keys(FIELDS)[fieldIndex]);
		/**
		on = !on;
		return api.putGroup(GROUP_ID, {
			on: on
		}).then(response => {
			console.log(response.body);
			return updateGroupUI();
		});
		*/
	});
});
