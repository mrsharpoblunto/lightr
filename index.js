const EventEmitter = require('events').EventEmitter;
const Gpio = require('onoff').Gpio;
const http = require('http');
const fork = require('child_process').fork;
const path = require('path');
const storage = require('node-persist');
const {
  bridgeIp, 
  userId, 
  aPin, bPin, togglePin
} = require('./config.json');

const FIELDS = {'bri': 8, 'hue': 1024, 'sat': 8};

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
  getGroups() {
    return this._httpGet('/groups');
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
	send(mode, state) {
		this._worker.send({ mode, state });
	}
}

class LightGroupController {
	constructor(groupId, api, worker) {
		this.groupId = groupId;
		this.api = api;
		this.worker = worker;
		this.groupState = null;
    this.fieldIndex = 0;
	}

	async init() {
		const {statusCode, body} = await this.api.getGroup(this.groupId);
    this.groupState = body.action;
    this.worker.send('lightgroup_control', body.action);
    return this.groupState;
	}

	async onEvent(event, args) {
    switch (event) {
      case 'rotation': {
        const field = Object.keys(FIELDS)[this.fieldIndex];
        const change = {
          [field]: FIELDS[field] * args,
          'on': true
        };
        if (this.groupState) {
          Object.keys(change).forEach(k => {
            if (typeof change[k] === 'number') {
              this.groupState[k] += change[k]
            } else {
              this.groupState[k] = change[k]
            }
          });
          this.worker.send('lightgroup_control',this.groupState);
        }

        const response = await this.api.putGroup(this.groupId, Object.keys(change).reduce((prev, next) => {
          const value = change[next];
          prev[next + (typeof value  === 'number' ? '_inc' : '')] = value;
          return prev;
        }, {}));
        await this.init();
        break;
      }

      case 'toggle': {
        this.fieldIndex++;
        if (this.fieldIndex >= Object.keys(FIELDS).length) {
          this.fieldIndex = 0;
        }
        break;
      }
    }
	}
}

class LightGroupSelector {
  constructor(api, uiWorker) {
    this.api = api;
    this.worker = uiWorker;
    this.selected = 0;

  }
  async init() {
    const response = await this.api.getGroups();
    this.options = Object.keys(response.body).map(i => ({ key: parseInt(i, 10), value: response.body[i].name }));
    this.worker.send('lightgroup_select', { 
      selected: this.selected, 
      options: this.options
    });
  }

  async onEvent(event, args) {
    switch (event) {
      case 'rotation': {
        this.selected += (args > 0 ? 1: -1);
        if (this.selected >= this.options.length) {
          this.selected = this.options.length - 1;
        } else if (this.selected < 0) {
          this.selected = 0;
        }
        this.worker.send('lightgroup_select', { 
          selected: this.selected, 
          options: this.options
        });
        break;
      }

      case 'toggle': {
        const groupId = this.options[this.selected].key;
        console.log('Selected groupId: ' + groupId);
        await storage.setItem('groupId', groupId);
        const newController = new LightGroupController(groupId, this.api, this.worker);
        await newController.init();
        controller = newController;
        break;
      }
    }
  }
}

let controller = null;

storage.init().then(async () => {
  const api = new HueAPI(bridgeIp, userId);
  const uiWorker = new Worker();
  const encoder = new RotaryEncoder({
    a: aPin,
    b: bPin,
    toggle: togglePin
  });

  const groupId = await storage.getItem('groupId');
  if (!groupId) {
    controller = new LightGroupSelector(api, uiWorker);
  } else {
    console.log('Controlling groupId: ' + groupId);
    controller = new LightGroupController(groupId, api, uiWorker);
  }
  await controller.init();

	encoder.on('rotation', throttlePromise((value) => controller.onEvent('rotation', value), {
		debounce: 100, 
		delay: 500, 
		reduce: (prev, next) => [prev[0] + next[0]]
	}));

	encoder.on('toggle',() => controller.onEvent('toggle'));
});
