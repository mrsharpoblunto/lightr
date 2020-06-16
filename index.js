/**
 * @format
 */
const EventEmitter = require('events').EventEmitter;
const Gpio = require('onoff').Gpio;
const http = require('http');
const fork = require('child_process').fork;
const path = require('path');
const storage = require('node-persist');
const {
  bridgeIp,
  userId,
  a1Pin,
  b1Pin,
  toggle1Pin,
  a2Pin,
  b2Pin,
  toggle2Pin,
  a3Pin,
  b3Pin,
  toggle3Pin,
} = require('./config.json');

const FIELDS = {hue: 1024, sat: 8, bri: 8};
const SELECT_PATTERN = [1, 2, 3, 2, 1, 3];

class RotaryEncoder extends EventEmitter {
  constructor({a1, b1, toggle1, a2, b2, toggle2, a3, b3, toggle3}) {
    super();
    this.gpio1A = new Gpio(a1, 'in', 'both');
    this.gpio1B = new Gpio(b1, 'in', 'both');
    this.gpio1Toggle = new Gpio(toggle1, 'in', 'rising', {debounceTimeout: 10});
    this.gpio2A = new Gpio(a2, 'in', 'both');
    this.gpio2B = new Gpio(b2, 'in', 'both');
    this.gpio2Toggle = new Gpio(toggle2, 'in', 'rising', {debounceTimeout: 10});
    this.gpio3A = new Gpio(a3, 'in', 'both');
    this.gpio3B = new Gpio(b3, 'in', 'both');
    this.gpio3Toggle = new Gpio(toggle3, 'in', 'rising', {debounceTimeout: 10});
    this._watch(1, this.gpio1A, this.gpio1B, this.gpio1Toggle);
    this._watch(2, this.gpio2A, this.gpio2B, this.gpio2Toggle);
    this._watch(3, this.gpio3A, this.gpio3B, this.gpio3Toggle);
  }

  _watch(index, gpioA, gpioB, gpioToggle) {
    gpioA.watch((err, value) => {
      if (err) {
        this.emit('error', err);
        return;
      }
      const a = value;

      try {
        const b = gpioB.readSync();
        if (a === b) {
          this.emit(`rotation${index}`, 1);
        } else {
          this.emit(`rotation${index}`, -1);
        }
      } catch (ex) {
        this.emit('error', ex);
      }
    });
    gpioToggle.watch((err, value) => {
      if (err) {
        this.emit('error', err);
        return;
      }
      this.emit('toggle' + index);
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
    return this._httpGet(`/groups/${groupId}`);
  }
  putGroup(groupId, data) {
    return this._httpPut(`/groups/${groupId}/action`, data);
  }
  _httpGet(path) {
    return new Promise((resolve, reject) => {
      http
        .get(
          {
            host: this.bridge,
            port: 80,
            path: '/api/' + this.user + path,
          },
          res => {
            res.setEncoding('utf8');
            let body = '';
            res.on('data', data => {
              body += data;
            });
            res.on('end', () => {
              let parsed;
              try {
                parsed = JSON.parse(body);
              } catch (ex) {}
              resolve({statusCode: res.statusCode, body: parsed || body});
            });
          },
        )
        .on('error', e => {
          reject(e);
        });
    });
  }
  _httpPut(path, data) {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: this.bridge,
          port: 80,
          method: 'PUT',
          path: '/api/' + this.user + path,
          headers: {'Content-Type': 'application/json'},
        },
        res => {
          res.setEncoding('utf8');
          let body = '';
          res.on('data', data => {
            body += data;
          });
          res.on('end', () => {
            let parsed;
            try {
              parsed = JSON.parse(body);
            } catch (ex) {}
            resolve({statusCode: res.statusCode, body: parsed || body});
          });
        },
      );
      req.on('error', e => {
        reject(e);
      });
      req.write(JSON.stringify(data));
      req.end();
    });
  }
}

function throttlePromise(
  fn,
  {reduce, debounce, delay} = {reduce: null, debounce: 0, delay: 0},
) {
  let running = false;
  let waiting = false;
  let start = Date.now();
  let lastArgs = null;
  let lastThis = null;
  const completed = function () {
    if (lastArgs != null) {
      const nextArgs = lastArgs;
      const nextThis = lastThis;
      lastArgs = null;
      lastThis = null;
      throttled.apply(nextThis, nextArgs);
    }
  };
  const throttled = function (...args) {
    if (running || waiting) {
      if (debounce && Date.now() - start < debounce) {
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
    fn.apply(this, args)
      .then(response => {
        running = false;
        if (!waiting) {
          completed();
        }
      })
      .catch(e => {
        console.log(e.stack);
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
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    });
    this._worker.stdout.on('data', data => {
      console.log(data.toString('utf8'));
    });
    this._worker.stderr.on('data', data => {
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
    this._worker.send({mode, state});
  }
}

class LightGroupController {
  constructor(groupId, api, worker) {
    console.log('Controlling groupId: ' + groupId);
    this.groupId = groupId;
    this.api = api;
    this.worker = worker;
    this.groupState = null;
    this.matchIndex = 0;
  }

  async init() {
    const {statusCode, body} = await this.api.getGroup(this.groupId);
    this.groupState = body.action;
    this.worker.send('lightgroup_control', body.action);
    return this.groupState;
  }

  async onEvent(event, args) {
    switch (event) {
      case 'rotation1':
        await this._rotate('bri', args);
        break;
      case 'rotation2':
        await this._rotate('sat', args);
        break;
      case 'rotation3':
        await this._rotate('hue', args);
        break;

      case 'toggle1':
      case 'toggle2':
      case 'toggle3': {
        if (this.matchIndex === SELECT_PATTERN.length) {
          return;
        }

        // check if the user has entered the select screen pattern
        const index = parseInt(event[event.length - 1], 10);
        if (index === SELECT_PATTERN[this.matchIndex++]) {
          if (this.matchIndex === SELECT_PATTERN.length) {
            const newController = new LightGroupSelector(this.api, this.worker);
            await newController.init();
            controller = newController;
            return;
          }
        } else {
          this.matchIndex = 0;
        }

        const response = await this.api.putGroup(this.groupId, {
          on: this.groupState ? !this.groupState.on : true,
        });
        await this.init();
        break;
      }
    }
  }

  async _rotate(field, value) {
    const change = {
      [field]: FIELDS[field] * value,
      on: true,
    };
    if (this.groupState) {
      Object.keys(change).forEach(k => {
        if (typeof change[k] === 'number') {
          this.groupState[k] += change[k];
        } else {
          this.groupState[k] = change[k];
        }
      });
      this.worker.send('lightgroup_control', this.groupState);
    }

    const response = await this.api.putGroup(
      this.groupId,
      Object.keys(change).reduce((prev, next) => {
        const value = change[next];
        prev[next + (typeof value === 'number' ? '_inc' : '')] = value;
        return prev;
      }, {}),
    );
    await this.init();
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
    this.options = Object.keys(response.body).map(i => ({
      key: parseInt(i, 10),
      value: response.body[i].name,
    }));
    this.worker.send('lightgroup_select', {
      selected: this.selected,
      options: this.options,
    });
  }

  async onEvent(event, args) {
    switch (event) {
      case 'rotation1':
      case 'rotation2':
      case 'rotation3': {
        this.selected += args > 0 ? 1 : -1;
        if (this.selected >= this.options.length) {
          this.selected = this.options.length - 1;
        } else if (this.selected < 0) {
          this.selected = 0;
        }
        this.worker.send('lightgroup_select', {
          selected: this.selected,
          options: this.options,
        });
        break;
      }

      case 'toggle1':
      case 'toggle2':
      case 'toggle3': {
        const groupId = this.options[this.selected].key;
        console.log('Selected groupId: ' + groupId);
        await storage.setItem('groupId', groupId);
        const newController = new LightGroupController(
          groupId,
          this.api,
          this.worker,
        );
        await newController.init();
        controller = newController;
        break;
      }
    }
  }
}

function retryUntilSuccess(action, onError) {
  const retry = resolve => {
    action()
      .then(result => {
        resolve(result);
      })
      .catch(err => {
        onError(err);
        setTimeout(() => retry(resolve), 1000);
      });
  };
  return new Promise((resolve, reject) => {
    retry(resolve);
  });
}

let controller = null;

storage.init().then(async () => {
  const api = new HueAPI(bridgeIp, userId);
  const uiWorker = new Worker();
  const encoder = new RotaryEncoder({
    a1: a1Pin,
    b1: b1Pin,
    toggle1: toggle1Pin,
    a2: a2Pin,
    b2: b2Pin,
    toggle2: toggle2Pin,
    a3: a3Pin,
    b3: b3Pin,
    toggle3: toggle3Pin,
  });

  const groupId = await storage.getItem('groupId');
  if (!groupId) {
    controller = new LightGroupSelector(api, uiWorker);
  } else {
    controller = new LightGroupController(groupId, api, uiWorker);
  }

  // wait until the hue bridge responds
  console.log('Attempting to contact Hue bridge...');
  await retryUntilSuccess(
    () => controller.init(),
    err => console.error(err),
  );

  for (let i = 1; i <= 3; ++i) {
    const rotationEvent = `rotation${i}`;
    encoder.on(
      rotationEvent,
      throttlePromise(
        value => {
          if (process.env.NODE_ENV !== 'production') {
            console.log(rotationEvent, value);
          }
          return controller.onEvent(rotationEvent, value);
        },
        {
          debounce: 100,
          delay: 500,
          reduce: (prev, next) => [prev[0] + next[0]],
        },
      ),
    );

    const toggleEvent = `toggle${i}`;
    encoder.on(toggleEvent, () => {
      if (process.env.NODE_ENV !== 'production') {
        console.log(toggleEvent);
      }
      return controller.onEvent(toggleEvent);
    });
  }
});
