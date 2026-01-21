import React, { useState, useEffect, useRef } from 'react';

const DRONE_SPEED = 10.0;
const CELL_SIZE = 10;
const REFILL_TIME = 30;
const EXTINGUISH_TIME = 40;
const MAX_WATER_CAPACITY = 3;

class Cell {
  constructor(elevation) {
    this.tree = true;
    this.fire = false;
    this.burnt = false;
    this.water = false;
    this.elevation = elevation;
    this.fire_cooldown = 0;
    this.extinguished_by_drone = false;
  }

  display() {
    if (this.fire) return '🔥';
    if (this.burnt) return this.extinguished_by_drone ? '🟩' : '⬛';
    if (this.water) return '🔷';
    if (this.tree) return '🌲';
    return ' ';
  }
}

class Environment {
  constructor(width = 40, height = 20) {
    this.width = width;
    this.height = height;
    this.grid = [];
    for (let y = 0; y < height; y++) {
      this.grid[y] = [];
      for (let x = 0; x < width; x++) {
        this.grid[y][x] = new Cell(Math.random() * 100);
      }
    }
    this.wind = [1, 0];
    this.active_fires = [];
  }

  add_water_blobs(count = 3) {
    const num_blobs = Math.floor(Math.random() * (count - 1)) + 2;
    for (let blob = 0; blob < num_blobs; blob++) {
      const cx = Math.floor(Math.random() * (this.width - 8)) + 4;
      const cy = Math.floor(Math.random() * (this.height - 8)) + 4;
      const steps = Math.floor(Math.random() * 15) + 15;
      let x = cx, y = cy;
      for (let i = 0; i < steps; i++) {
        if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
          this.grid[y][x].water = true;
          this.grid[y][x].tree = false;
        }
        x += Math.floor(Math.random() * 3) - 1;
        y += Math.floor(Math.random() * 3) - 1;
      }
    }
  }

  ignite(x, y) {
    if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
      const cell = this.grid[y][x];
      if (cell.tree && !cell.fire && !cell.burnt && !cell.water) {
        cell.fire = true;
        cell.fire_cooldown = 3;
        this.active_fires.push([x, y]);
      }
    }
  }

  spread_fire() {
    const new_fires = [];
    const still_active = [];

    for (let [x, y] of this.active_fires) {
      const cell = this.grid[y][x];
      if (cell.fire_cooldown > 0) cell.fire_cooldown--;

      if (Math.random() < 0.03) {
        cell.fire = false;
        cell.burnt = true;
        cell.extinguished_by_drone = false;
        continue;
      }

      if (cell.fire_cooldown === 0) {
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
              const ncell = this.grid[ny][nx];
              if (ncell.tree && !ncell.fire && !ncell.burnt && !ncell.water) {
                const elev_diff = ncell.elevation - cell.elevation;
                let base_prob = 0.05 + elev_diff * 0.003;
                if (dx === this.wind[0] && dy === this.wind[1]) base_prob += 0.08;
                if (Math.random() < Math.min(Math.max(base_prob, 0.005), 0.4)) {
                  ncell.fire = true;
                  ncell.fire_cooldown = 2;
                  new_fires.push([nx, ny]);
                }
              }
            }
          }
        }
        cell.fire_cooldown = 2;
      }
      still_active.push([x, y]);
    }

    this.active_fires = still_active.filter(([x, y]) => this.grid[y][x].fire).concat(new_fires);
  }

  extinguish_fire_at(x, y, drone_pos = null, simulation_time = null) {
    if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
      const cell = this.grid[y][x];
      if (cell.fire) {
        if (simulation_time && drone_pos) {
          const dx = x - drone_pos[0];
          const dy = y - drone_pos[1];
          const distance = Math.sqrt(dx * dx + dy * dy) * CELL_SIZE;
          const travel_time = distance / DRONE_SPEED;
          simulation_time[0] += travel_time + EXTINGUISH_TIME;
        }
        cell.fire = false;
        cell.burnt = true;
        cell.tree = false;
        cell.fire_cooldown = 0;
        cell.extinguished_by_drone = true;
        this.active_fires = this.active_fires.filter(f => !(f[0] === x && f[1] === y));
        return true;
      }
    }
    return false;
  }

  get_attraction_matrix() {
    const matrix = Array(this.height).fill(0).map(() => Array(this.width).fill(0));
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const cell = this.grid[y][x];
        if (cell.fire) matrix[y][x] = 5;
        else if (cell.burnt) matrix[y][x] = 4;
        else if (cell.water) matrix[y][x] = 3;
      }
    }
    return matrix;
  }

  count_trees() {
    let saved = 0, burnt = 0;
    for (let row of this.grid) {
      for (let cell of row) {
        if (cell.tree) saved++;
        else if (cell.burnt) burnt++;
      }
    }
    return [saved, burnt];
  }
}

class DroneSwarm {
  constructor(env, num_drones = 20) {
    this.env = env;
    this.num_drones = num_drones;
    this.positions = Array(num_drones).fill(0).map(() => [
      Math.random() * (env.width - 1),
      Math.random() * (env.height - 1)
    ]);
    this.velocities = Array(num_drones).fill(0).map(() => [
      (Math.random() - 0.5) * 3,
      (Math.random() - 0.5) * 3
    ]);
    this.pbest_positions = this.positions.map(p => [...p]);
    this.pbest_values = this.positions.map(p => this.fitness(p));
    const best_idx = this.pbest_values.indexOf(Math.min(...this.pbest_values));
    this.gbest_position = [...this.pbest_positions[best_idx]];
    this.gbest_value = this.pbest_values[best_idx];

    this.water_left = Array(num_drones).fill(MAX_WATER_CAPACITY);
    this.refill_timers = Array(num_drones).fill(0);
    this.omega = 0.7;
    this.phi_p = 1.5;
    this.phi_g = 1.5;
  }

  fitness(pos) {
    const [px, py] = pos;
    const x = Math.floor(px), y = Math.floor(py);
    if (x < 0 || x >= this.env.width || y < 0 || y >= this.env.height) return 1e6;

    const matrix = this.env.get_attraction_matrix();
    const cell_value = matrix[y][x];

    const water_positions = [];
    for (let yy = 0; yy < this.env.height; yy++) {
      for (let xx = 0; xx < this.env.width; xx++) {
        if (matrix[yy][xx] === 3) water_positions.push([yy, xx]);
      }
    }
    let min_dist_water = Infinity;
    if (water_positions.length > 0) {
      for (let [wy, wx] of water_positions) {
        const dist = Math.sqrt((wx - x) ** 2 + (wy - y) ** 2);
        min_dist_water = Math.min(min_dist_water, dist);
      }
    }

    if (cell_value === 5) return -100 + min_dist_water;
    if (cell_value === 3) return -10;
    if (cell_value === 4) return 1000;

    const fire_positions = [];
    for (let yy = 0; yy < this.env.height; yy++) {
      for (let xx = 0; xx < this.env.width; xx++) {
        if (matrix[yy][xx] === 5) fire_positions.push([yy, xx]);
      }
    }
    let min_dist_fire = 0;
    if (fire_positions.length > 0) {
      let min = Infinity;
      for (let [fy, fx] of fire_positions) {
        const dist = Math.sqrt((fx - x) ** 2 + (fy - y) ** 2);
        min = Math.min(min, dist);
      }
      min_dist_fire = min;
    }
    return fire_positions.length > 0 ? min_dist_fire : 100;
  }

  step(iteration, simulation_time) {
    for (let i = 0; i < this.num_drones; i++) {
      const r_p = Math.random();
      const r_g = Math.random();

      this.velocities[i][0] =
        this.omega * this.velocities[i][0] +
        this.phi_p * r_p * (this.pbest_positions[i][0] - this.positions[i][0]) +
        this.phi_g * r_g * (this.gbest_position[0] - this.positions[i][0]);

      this.velocities[i][1] =
        this.omega * this.velocities[i][1] +
        this.phi_p * r_p * (this.pbest_positions[i][1] - this.positions[i][1]) +
        this.phi_g * r_g * (this.gbest_position[1] - this.positions[i][1]);

      this.positions[i][0] += this.velocities[i][0];
      this.positions[i][1] += this.velocities[i][1];

      this.positions[i][0] = Math.max(0, Math.min(this.env.width - 1, this.positions[i][0]));
      this.positions[i][1] = Math.max(0, Math.min(this.env.height - 1, this.positions[i][1]));
    }

    for (let i = 0; i < this.num_drones; i++) {
      const fitness = this.fitness(this.positions[i]);
      if (fitness < this.pbest_values[i]) {
        this.pbest_positions[i] = [...this.positions[i]];
        this.pbest_values[i] = fitness;
        if (fitness < this.gbest_value) {
          this.gbest_position = [...this.positions[i]];
          this.gbest_value = fitness;
        }
      }
    }

    let extinguished_count = 0;
    for (let i = 0; i < this.num_drones; i++) {
      const [px, py] = this.positions[i];
      const x = Math.floor(px), y = Math.floor(py);

      if (x < 0 || x >= this.env.width || y < 0 || y >= this.env.height) continue;

      const cell = this.env.grid[y][x];

      if (this.water_left[i] === 0) {
        if (cell.water) {
          this.refill_timers[i]++;
          if (this.refill_timers[i] >= REFILL_TIME) {
            this.water_left[i] = MAX_WATER_CAPACITY;
            this.refill_timers[i] = 0;
          }
        }
        continue;
      }

      let extinguished_local = 0;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (extinguished_local >= 3 || this.water_left[i] <= 0) break;
          const nx = x + dx, ny = y + dy;
          if (this.env.extinguish_fire_at(nx, ny, [x, y], simulation_time)) {
            extinguished_count++;
            extinguished_local++;
            this.water_left[i]--;
          }
        }
      }
    }

    return [extinguished_count, this.omega, this.phi_p, this.phi_g, 0, 0];
  }
}

const FireSuppressionSimulation = () => {
  const gridRef = useRef(null);
  const [omega, setOmega] = useState(0.7);
  const [phiP, setPhiP] = useState(1.5);
  const [phiG, setPhiG] = useState(1.5);
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState(0);
  const [stats, setStats] = useState({
    fires: 0,
    extinguished: 0,
    saved: 0,
    burnt: 0,
    elapsed_time: 0
  });
  const simRef = useRef(null);
  const envRef = useRef(null);
  const stepCountRef = useRef(0);
  const simTimeRef = useRef([0]);
  const totalExtinguishedRef = useRef(0);

  const initSim = () => {
    const env = new Environment(40, 20);
    env.add_water_blobs(3);
    for (let i = 0; i < 5; i++) {
      const x = Math.floor(Math.random() * (env.width / 3)) + Math.floor(env.width / 3);
      const y = Math.floor(Math.random() * (env.height / 3)) + Math.floor(env.height / 3);
      env.ignite(x, y);
    }

    envRef.current = env;
    simRef.current = null;
    stepCountRef.current = 0;
    simTimeRef.current = [0];
    totalExtinguishedRef.current = 0;
    setStep(0);
    updateStats(env, 0, 0);
    render(env, []);
  };

  const updateStats = (env, extCount, elapsed) => {
    const [saved, burnt] = env.count_trees();
    setStats({
      fires: env.active_fires.length,
      extinguished: extCount,
      saved,
      burnt,
      elapsed_time: elapsed
    });
  };

  const render = (env, drones_pos) => {
    const grid = gridRef.current;
    if (!grid) return;

    let html = '';
    for (let y = 0; y < env.height; y++) {
      let row = '';
      for (let x = 0; x < env.width; x++) {
        const cell = env.grid[y][x];
        let emoji = cell.display();

        const hasDrone = drones_pos.some(([dx, dy]) => dx === x && dy === y);
        if (hasDrone) emoji = '🚁';

        row += `<span class="inline-block w-8">${emoji}</span>`;
      }
      html += `<div class="leading-none">${row}</div>`;
    }

    grid.innerHTML = html;
  };

  const step_sim = () => {
    if (!envRef.current) return;
    const env = envRef.current;

    env.spread_fire();

    if (stepCountRef.current === 10) {
      const swarm = new DroneSwarm(env, 20);
      swarm.omega = omega;
      swarm.phi_p = phiP;
      swarm.phi_g = phiG;
      simRef.current = swarm;
      simTimeRef.current = [0];
    }

    if (simRef.current) {
      const swarm = simRef.current;
      swarm.omega = omega;
      swarm.phi_p = phiP;
      swarm.phi_g = phiG;

      const [extinguished, w, pp, pg, div, rew] = swarm.step(stepCountRef.current, simTimeRef.current);
      totalExtinguishedRef.current += extinguished;
      const drones_pos = swarm.positions.map(p => [Math.floor(p[0]), Math.floor(p[1])]);
      render(env, drones_pos);
    } else {
      render(env, []);
    }

    if (stepCountRef.current % 15 === 0 && Math.random() < 0.3) {
      const x = Math.floor(Math.random() * env.width);
      const y = Math.floor(Math.random() * env.height);
      env.ignite(x, y);
    }

    stepCountRef.current++;
    setStep(stepCountRef.current);
    updateStats(env, totalExtinguishedRef.current, simTimeRef.current[0]);

    if (env.active_fires.length === 0 && stepCountRef.current > 20) {
      setRunning(false);
    }
  };

  useEffect(() => {
    if (!running) return;
    const int = setInterval(step_sim, 200);
    return () => clearInterval(int);
  }, [running, omega, phiP, phiG]);

  return (
    <div className="relative py-24 px-6 bg-slate-900">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-12">
          <h2 className="text-5xl md:text-6xl font-bold mb-6 bg-gradient-to-r from-blue-400 to-cyan-500 bg-clip-text text-transparent">
            Live Simulation
          </h2>
          <p className="text-xl text-gray-400 max-w-3xl mx-auto">
            Watch how our swarm technology coordinates to suppress wildfire threats
          </p>
        </div>

        <div className="relative bg-gradient-to-br from-slate-800 to-slate-900 rounded-3xl border-2 border-slate-700 overflow-hidden shadow-2xl">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-orange-500 via-red-500 to-purple-500"></div>

          <div className="relative w-full h-[600px] bg-black p-6 overflow-auto flex items-start justify-center">
            <div ref={gridRef} className="font-mono text-center leading-none text-xl whitespace-nowrap" style={{fontFamily: 'monospace', letterSpacing: '-0.3em'}} />
          </div>

          <div className="border-t border-slate-700 bg-slate-900/50 backdrop-blur-sm p-6">
            <div className="grid md:grid-cols-3 gap-6 mb-6">
              <div className="bg-slate-800/50 p-4 rounded-lg">
                <label className="block text-sm font-semibold text-gray-300 mb-2">
                  Omega (ω) - Inertia: <span id="omegaValue" className="text-orange-400">{omega.toFixed(1)}</span>
                </label>
                <input
                  type="range"
                  min="0.1"
                  max="1.0"
                  step="0.1"
                  value={omega}
                  onChange={(e) => setOmega(parseFloat(e.target.value))}
                  className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-orange-500"
                />
                <div className="flex justify-between text-xs text-gray-500 mt-1">
                  <span>0.1</span>
                  <span>1.0</span>
                </div>
              </div>

              <div className="bg-slate-800/50 p-4 rounded-lg">
                <label className="block text-sm font-semibold text-gray-300 mb-2">
                  Phi P (φₚ) - Personal: <span id="phipValue" className="text-blue-400">{phiP.toFixed(1)}</span>
                </label>
                <input
                  type="range"
                  min="0.5"
                  max="3.0"
                  step="0.1"
                  value={phiP}
                  onChange={(e) => setPhiP(parseFloat(e.target.value))}
                  className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                />
                <div className="flex justify-between text-xs text-gray-500 mt-1">
                  <span>0.5</span>
                  <span>3.0</span>
                </div>
              </div>

              <div className="bg-slate-800/50 p-4 rounded-lg">
                <label className="block text-sm font-semibold text-gray-300 mb-2">
                  Phi G (φᵍ) - Global: <span id="phigValue" className="text-purple-400">{phiG.toFixed(1)}</span>
                </label>
                <input
                  type="range"
                  min="0.5"
                  max="3.0"
                  step="0.1"
                  value={phiG}
                  onChange={(e) => setPhiG(parseFloat(e.target.value))}
                  className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-purple-500"
                />
                <div className="flex justify-between text-xs text-gray-500 mt-1">
                  <span>0.5</span>
                  <span>3.0</span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-4 justify-center items-center">
              <button
                onClick={() => {
                  initSim();
                  setRunning(true);
                }}
                className="px-6 py-3 bg-gradient-to-r from-green-500 to-emerald-600 rounded-lg font-semibold hover:from-green-600 hover:to-emerald-700 transition-all duration-300 shadow-lg shadow-green-500/25"
              >
                Start Simulation
              </button>
              <button
                onClick={() => setRunning(false)}
                className="px-6 py-3 bg-gradient-to-r from-red-500 to-orange-600 rounded-lg font-semibold hover:from-red-600 hover:to-orange-700 transition-all duration-300 shadow-lg shadow-red-500/25"
              >
                Stop
              </button>
              <button
                onClick={() => {
                  setRunning(false);
                  initSim();
                }}
                className="px-6 py-3 bg-slate-700 hover:bg-slate-600 rounded-lg font-semibold transition-all duration-300"
              >
                Reset
              </button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
              <div className="flex items-center gap-3 px-4 py-3 bg-slate-800 rounded-lg">
                <span className="text-gray-400">Step:</span>
                <span id="stepCount" className="font-bold text-cyan-400">{step}</span>
              </div>
              <div className="flex items-center gap-3 px-4 py-3 bg-slate-800 rounded-lg">
                <span className="text-gray-400">Fires:</span>
                <span id="fireCount" className="font-bold text-orange-400">{stats.fires}</span>
              </div>
              <div className="flex items-center gap-3 px-4 py-3 bg-slate-800 rounded-lg">
                <span className="text-gray-400">Extinguished:</span>
                <span id="extinguishedCount" className="font-bold text-green-400">{stats.extinguished}</span>
              </div>
              <div className="flex items-center gap-3 px-4 py-3 bg-slate-800 rounded-lg">
                <span className="text-gray-400">Efficiency:</span>
                <span id="diversityValue" className="font-bold text-purple-400">
                  {stats.saved + stats.burnt > 0 ? ((stats.saved / (stats.saved + stats.burnt)) * 100).toFixed(1) : 0}%
                </span>
              </div>
            </div>

            <div className="mt-4 p-4 bg-slate-800/50 rounded-lg">
              <div className="text-sm text-gray-400 mb-2">Current PSO Parameters:</div>
              <div className="flex flex-wrap gap-4 justify-center text-sm">
                <span className="text-orange-400">ω = <span id="currentOmega">{omega.toFixed(2)}</span></span>
                <span className="text-blue-400">φₚ = <span id="currentPhip">{phiP.toFixed(2)}</span></span>
                <span className="text-purple-400">φᵍ = <span id="currentPhig">{phiG.toFixed(2)}</span></span>
                <span className="text-yellow-400">Elapsed Time = <span id="rewardValue">{stats.elapsed_time.toFixed(2)}s</span></span>
              </div>
            </div>

            {step < 10 && (
              <div className="mt-4 p-3 bg-blue-500/20 border border-blue-500/30 rounded-lg text-blue-300 text-center">
                🚁 Drones will deploy at step 10...
              </div>
            )}

            <div className="mt-6 grid md:grid-cols-2 gap-6">
              <div className="bg-slate-800/50 p-4 rounded-lg">
                <div className="text-sm font-semibold text-gray-300 mb-3">🗺️ Legend</div>
                <div className="space-y-2 text-sm text-gray-400">
                  <p>🌲 Forest (Trees)</p>
                  <p>🔥 Active Fire</p>
                  <p>🟩 Extinguished by Drone</p>
                  <p>⬛ Burnt Naturally</p>
                  <p>🔷 Water Source</p>
                  <p>🚁 Drone</p>
                </div>
              </div>

              <div className="bg-slate-800/50 p-4 rounded-lg">
                <div className="text-sm font-semibold text-gray-300 mb-3">ℹ️ Notes</div>
                <div className="space-y-2 text-sm text-gray-400">
                  <p>• Drones deploy at step 10</p>
                  <p>• Adjust parameters before or during simulation</p>
                  <p>• Fire spreads based on elevation and wind</p>
                  <p>• Drones refill water at blue sources</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FireSuppressionSimulation;