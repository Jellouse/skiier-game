(function () {
  "use strict";

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const rand = (min, max) => min + Math.random() * (max - min);
  const intersects = (a, b) =>
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  class SkierGame {
    constructor(canvas) {
      if (!(canvas instanceof HTMLCanvasElement)) {
        throw new Error("createSkierGame expects a canvas.");
      }

      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.renderCtx = this.ctx;
      this.dpr = Math.max(1, Math.min(2.5, window.devicePixelRatio || 1));
      this.width = 0;
      this.height = 0;

      this.pixelScale = 4;
      this.pixelCanvas = document.createElement("canvas");
      this.pixelCtx = this.pixelCanvas.getContext("2d", { alpha: false });

      this.gravity = 1950;
      this.jumpVelocity = -700;
      this.jumpHoldForce = 1900;
      this.jumpHoldMax = 0.22;
      this.jumpReleaseCut = 0.5;
      this.backflipHoldThreshold = 0.24;
      this.backflipMinHeight = 145;
      this.backflipMaxSpinSpeed = Math.PI * 12;
      this.stormStartDistance = 2600;
      this.stormPeakDistance = 9800;
      this.stormFadeStartDistance = 13800;
      this.stormEndDistance = 21000;
      this.speedStart = 300;
      this.speedMax = 980;
      this.speedGain = 14;
      this.playerXRatio = 0.165;

      this.state = "ready";
      this.elapsed = 0;
      this.scroll = 0;
      this.speed = this.speedStart;
      this.gameOverTimer = 0;
      this.score = 0;
      this.highScore = this.readHighScore();
      this.stormIntensity = 0;

      this.player = {
        airY: 0,
        vy: 0,
        grounded: true,
        crashTilt: 0,
        jumpHoldTime: 0,
        backflipActive: false,
        backflipProgress: 0,
        backflipTriggered: false,
        maxJumpHeight: 0,
        jumpHeldDuration: 0,
      };

      this.input = {
        spaceHeld: false,
      };

      this.skierImage = new Image();
      this.skierImageLoaded = false;
      this.skierCrop = { x: 38, y: 34, w: 131, h: 114 };
      this.skierImage.onload = () => {
        this.skierImageLoaded = true;
      };
      this.skierImage.src = "Mask%20group.png";

      this.obstacles = [];
      this.nextSpawnAt = 900;
      this.snowMarks = Array.from({ length: 10 }, () => this.createSnowMark());
      this.stormFlakes = Array.from({ length: 140 }, () => this.createStormFlake());

      this.lastFrame = performance.now();
      this.rafId = null;

      this.onResize = () => this.resize();
      this.onKeyDown = (event) => this.handleKeyDown(event);
      this.onKeyUp = (event) => this.handleKeyUp(event);
      window.addEventListener("resize", this.onResize);
      window.addEventListener("keydown", this.onKeyDown, { passive: false });
      window.addEventListener("keyup", this.onKeyUp, { passive: false });

      this.resize();
      this.frame(this.lastFrame);
    }

    destroy() {
      if (this.rafId) {
        cancelAnimationFrame(this.rafId);
      }
      window.removeEventListener("resize", this.onResize);
      window.removeEventListener("keydown", this.onKeyDown);
      window.removeEventListener("keyup", this.onKeyUp);
    }

    resize() {
      const rect = this.canvas.getBoundingClientRect();
      this.width = rect.width || 1280;
      this.height = rect.height || 800;

      this.canvas.width = Math.round(this.width * this.dpr);
      this.canvas.height = Math.round(this.height * this.dpr);
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.ctx.imageSmoothingEnabled = false;

      this.pixelCanvas.width = Math.max(1, Math.floor(this.width / this.pixelScale));
      this.pixelCanvas.height = Math.max(1, Math.floor(this.height / this.pixelScale));
      this.pixelCtx.imageSmoothingEnabled = false;
      this.stormFlakes.forEach((flake) => this.resetStormFlake(flake, true));
    }

    handleKeyDown(event) {
      if (event.code !== "Space") {
        return;
      }
      event.preventDefault();
      this.input.spaceHeld = true;

      if (this.state === "ready") {
        this.startGame();
        this.jump();
        return;
      }

      if (this.state === "running") {
        this.jump();
        return;
      }

      if (this.state === "gameover" && this.gameOverTimer > 0.18) {
        this.resetGame();
        this.startGame();
      }
    }

    handleKeyUp(event) {
      if (event.code !== "Space") {
        return;
      }
      event.preventDefault();
      this.input.spaceHeld = false;

      if (this.state === "running" && !this.player.grounded && this.player.vy < 0) {
        this.player.vy *= this.jumpReleaseCut;
        this.player.jumpHoldTime = this.jumpHoldMax;
      }
    }

    startGame() {
      this.state = "running";
    }

    resetGame() {
      this.state = "ready";
      this.elapsed = 0;
      this.scroll = 0;
      this.speed = this.speedStart;
      this.gameOverTimer = 0;
      this.score = 0;
      this.stormIntensity = 0;
      this.player.airY = 0;
      this.player.vy = 0;
      this.player.grounded = true;
      this.player.crashTilt = 0;
      this.player.jumpHoldTime = 0;
      this.player.backflipActive = false;
      this.player.backflipProgress = 0;
      this.player.backflipTriggered = false;
      this.player.maxJumpHeight = 0;
      this.player.jumpHeldDuration = 0;
      this.input.spaceHeld = false;
      this.obstacles = [];
      this.nextSpawnAt = this.width * 0.8;
      this.snowMarks.forEach((mark) => this.resetSnowMark(mark, true));
      this.stormFlakes.forEach((flake) => this.resetStormFlake(flake, true));
    }

    jump() {
      if (!this.player.grounded || this.state !== "running") {
        return;
      }
      this.player.grounded = false;
      this.player.vy = this.jumpVelocity;
      this.player.jumpHoldTime = 0;
      this.player.backflipActive = false;
      this.player.backflipProgress = 0;
      this.player.backflipTriggered = false;
      this.player.maxJumpHeight = 0;
      this.player.jumpHeldDuration = 0;
    }

    frame(now) {
      const dt = clamp((now - this.lastFrame) / 1000, 0, 1 / 28);
      this.lastFrame = now;

      this.update(dt);
      this.draw();
      this.rafId = requestAnimationFrame((t) => this.frame(t));
    }

    update(dt) {
      this.updateSnowMarks(dt);
      this.updateStorm(dt);

      if (this.state === "ready") {
        return;
      }

      if (this.state === "gameover") {
        this.gameOverTimer += dt;
        this.player.vy += this.gravity * dt;
        this.player.airY += this.player.vy * dt;
        this.player.crashTilt = Math.min(1.35, this.player.crashTilt + dt * 2.4);
        if (this.player.airY > 58) {
          this.player.airY = 58;
          this.player.vy = 0;
        }
        return;
      }

      this.elapsed += dt;
      this.speed = Math.min(this.speedMax, this.speedStart + this.elapsed * this.speedGain);
      this.scroll += this.speed * dt;
      this.score = Math.max(0, Math.floor(this.scroll * 0.1));
      if (this.score > this.highScore) {
        this.highScore = this.score;
        this.persistHighScore(this.highScore);
      }

      this.player.vy += this.gravity * dt;
      if (!this.player.grounded && this.input.spaceHeld) {
        this.player.jumpHeldDuration += dt;
      }
      if (
        this.input.spaceHeld &&
        this.player.vy < 0 &&
        this.player.jumpHoldTime < this.jumpHoldMax
      ) {
        this.player.vy -= this.jumpHoldForce * dt;
        this.player.jumpHoldTime += dt;
      }
      this.player.airY += this.player.vy * dt;

      const jumpHeight = -this.player.airY;
      this.player.maxJumpHeight = Math.max(this.player.maxJumpHeight, jumpHeight);
      if (
        !this.player.backflipTriggered &&
        this.player.jumpHeldDuration >= this.backflipHoldThreshold &&
        this.player.maxJumpHeight >= this.backflipMinHeight
      ) {
        this.player.backflipActive = true;
        this.player.backflipTriggered = true;
      }

      if (this.player.backflipActive) {
        const remainingAngle = Math.max(0, Math.PI * 2 - this.player.backflipProgress);
        const timeToGround = this.estimateTimeToGround();
        const adaptiveSpinSpeed = clamp(
          remainingAngle / Math.max(timeToGround, dt),
          Math.PI * 2.5,
          this.backflipMaxSpinSpeed
        );
        this.player.backflipProgress = Math.min(
          Math.PI * 2,
          this.player.backflipProgress + adaptiveSpinSpeed * dt
        );
        if (this.player.backflipProgress >= Math.PI * 2) {
          this.player.backflipActive = false;
        }
      }

      if (this.player.airY >= 0) {
        this.player.airY = 0;
        this.player.vy = 0;
        this.player.grounded = true;
        this.player.jumpHoldTime = 0;
        this.player.backflipActive = false;
        this.player.backflipProgress = 0;
        this.player.backflipTriggered = false;
        this.player.maxJumpHeight = 0;
        this.player.jumpHeldDuration = 0;
      } else {
        this.player.grounded = false;
      }

      this.spawnObstacles();
      this.obstacles = this.obstacles.filter((obstacle) => obstacle.worldX > this.scroll - 120);
      this.checkCollision();
    }

    createSnowMark() {
      return {
        x: rand(0, this.width || 1280),
        y: rand((this.height || 800) * 0.05, (this.height || 800) * 0.34),
        length: rand(20, 46),
      };
    }

    resetSnowMark(mark, anywhere) {
      mark.x = anywhere ? rand(0, this.width) : this.width + rand(20, this.width * 0.8);
      mark.y = rand(this.height * 0.05, this.height * 0.34);
      mark.length = rand(20, 46);
    }

    updateSnowMarks(dt) {
      const drift = (this.speed * 0.06 + 14) * dt;
      for (const mark of this.snowMarks) {
        mark.x -= drift;
        if (mark.x + mark.length < -30) {
          this.resetSnowMark(mark, false);
        }
      }
    }

    estimateTimeToGround() {
      const c = this.player.airY;
      if (c >= 0) {
        return 0.0001;
      }

      let effectiveGravity = this.gravity;
      if (
        this.input.spaceHeld &&
        this.player.vy < 0 &&
        this.player.jumpHoldTime < this.jumpHoldMax
      ) {
        effectiveGravity = Math.max(80, this.gravity - this.jumpHoldForce);
      }

      const a = 0.5 * effectiveGravity;
      const b = this.player.vy;
      const discriminant = b * b - 4 * a * c;
      if (discriminant <= 0 || a <= 0) {
        return 0.0001;
      }

      const sqrtDisc = Math.sqrt(discriminant);
      const t1 = (-b - sqrtDisc) / (2 * a);
      const t2 = (-b + sqrtDisc) / (2 * a);
      const candidates = [t1, t2].filter((t) => t > 0);
      if (candidates.length === 0) {
        return 0.0001;
      }
      return Math.max(0.0001, Math.min(...candidates));
    }

    createStormFlake() {
      return {
        x: rand(0, this.width || 1280),
        y: rand(-(this.height || 800) * 0.3, (this.height || 800) * 0.9),
        length: rand(8, 18),
        depth: rand(0.45, 1.65),
      };
    }

    resetStormFlake(flake, anywhere) {
      flake.x = anywhere ? rand(0, this.width) : this.width + rand(0, this.width * 0.7);
      flake.y = anywhere
        ? rand(-this.height * 0.25, this.height * 0.9)
        : rand(-this.height * 0.35, this.height * 0.25);
      flake.length = rand(8, 18);
      flake.depth = rand(0.45, 1.65);
    }

    updateStorm(dt) {
      let target = 0;
      if (this.state === "running") {
        if (this.scroll < this.stormStartDistance) {
          target = 0;
        } else if (this.scroll < this.stormPeakDistance) {
          const rampIn = clamp(
            (this.scroll - this.stormStartDistance) /
              (this.stormPeakDistance - this.stormStartDistance),
            0,
            1
          );
          target = rampIn * rampIn * (3 - 2 * rampIn);
        } else if (this.scroll < this.stormFadeStartDistance) {
          target = 1;
        } else if (this.scroll < this.stormEndDistance) {
          const rampOut = clamp(
            (this.scroll - this.stormFadeStartDistance) /
              (this.stormEndDistance - this.stormFadeStartDistance),
            0,
            1
          );
          const easedOut = rampOut * rampOut * (3 - 2 * rampOut);
          target = 1 - easedOut;
        } else {
          target = 0;
        }
      } else if (this.state === "gameover") {
        target = this.stormIntensity;
      }

      this.stormIntensity += (target - this.stormIntensity) * Math.min(1, dt * 2.5);
      if (this.stormIntensity < 0.001) {
        this.stormIntensity = 0;
      }

      const driftSpeed = (this.speed * 0.24 + 160) * (0.25 + this.stormIntensity * 1.25);
      const fallSpeed = (32 + this.speed * 0.08) * (0.2 + this.stormIntensity * 1.8);
      for (const flake of this.stormFlakes) {
        flake.x -= driftSpeed * flake.depth * dt;
        flake.y += fallSpeed * (0.8 + flake.depth * 0.6) * dt;
        if (flake.x + flake.length < -30 || flake.y > this.height + 40) {
          this.resetStormFlake(flake, false);
        }
      }
    }

    spawnObstacles() {
      const spawnUntil = this.scroll + this.width * 1.25;
      while (this.nextSpawnAt < spawnUntil) {
        this.obstacles.push(this.createObstacle(this.nextSpawnAt));

        const difficulty = clamp(this.elapsed / 55, 0, 1);
        const gap = clamp(rand(380, 620) - difficulty * 120, 260, 620);
        this.nextSpawnAt += gap;

        if (Math.random() < difficulty * 0.12) {
          this.obstacles.push(this.createObstacle(this.nextSpawnAt + rand(150, 230)));
          this.nextSpawnAt += rand(190, 260);
        }
      }
    }

    createObstacle(worldX) {
      const width = rand(44, 86);
      const height = rand(18, 36);
      return {
        worldX,
        width,
        height,
        tipShift: rand(-0.25, 0.3),
      };
    }

    lineYAt(screenX) {
      const worldX = this.scroll + screenX;
      const longWaveA = Math.sin(worldX * 0.0022 + 0.9) * (this.height * 0.06);
      const longWaveB = Math.sin(worldX * 0.00105 - 0.4) * (this.height * 0.035);
      const longWaveC = Math.cos(worldX * 0.00055 + 1.5) * (this.height * 0.02);
      return this.height * 0.6 + screenX * 0.19 + longWaveA + longWaveB + longWaveC;
    }

    mountainYAt(screenX) {
      const p = (screenX + this.scroll * 0.13) / this.width;
      const ridge = this.height * 0.56;
      const peak = this.height * 0.47;
      const baseWave = Math.sin((this.scroll * 0.13 + screenX) * 0.0013) * 8;
      if (p < 0.25) {
        return ridge + baseWave;
      }
      if (p < 0.72) {
        const t = (p - 0.25) / 0.47;
        return ridge - t * (ridge - peak) + baseWave;
      }
      const t = (p - 0.72) / 0.5;
      return peak + t * (this.height * 0.61 - peak) + baseWave;
    }

    getPlayerRect() {
      const x = this.width * this.playerXRatio;
      const y = this.lineYAt(x) + this.player.airY;
      return { x: x - 25, y: y - 76, w: 58, h: 66 };
    }

    obstacleRect(obstacle) {
      const x = obstacle.worldX - this.scroll;
      const leftX = x - obstacle.width * 0.58;
      const rightX = x + obstacle.width * 0.58;
      const baseYLeft = this.lineYAt(leftX);
      const baseYRight = this.lineYAt(rightX);
      const topY = Math.min(baseYLeft, baseYRight) - obstacle.height;
      return {
        x: leftX,
        y: topY,
        w: rightX - leftX,
        h: obstacle.height + Math.abs(baseYRight - baseYLeft) + 4,
      };
    }

    checkCollision() {
      const player = this.getPlayerRect();
      for (const obstacle of this.obstacles) {
        const obstacleRect = this.obstacleRect(obstacle);
        if (obstacleRect.x > this.width + 50 || obstacleRect.x + obstacleRect.w < -60) {
          continue;
        }
        if (intersects(player, obstacleRect)) {
          this.state = "gameover";
          this.gameOverTimer = 0;
          this.player.vy = -280;
          this.player.grounded = false;
          if (this.score > this.highScore) {
            this.highScore = this.score;
            this.persistHighScore(this.highScore);
          }
          break;
        }
      }
    }

    draw() {
      const pctx = this.pixelCtx;

      pctx.setTransform(1, 0, 0, 1, 0, 0);
      pctx.clearRect(0, 0, this.pixelCanvas.width, this.pixelCanvas.height);
      pctx.setTransform(1 / this.pixelScale, 0, 0, 1 / this.pixelScale, 0, 0);
      pctx.imageSmoothingEnabled = false;

      this.renderCtx = pctx;
      this.drawBackground();
      this.drawMountain();
      this.drawMainSlope();
      this.drawObstacles();
      this.drawSkier();
      this.drawStormOverlay();

      this.renderCtx = this.ctx;
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.ctx.imageSmoothingEnabled = false;
      this.ctx.clearRect(0, 0, this.width, this.height);
      const contrastPct = Math.round(100 - this.stormIntensity * 56);
      const brightnessPct = Math.round(100 + this.stormIntensity * 6);
      this.ctx.filter = `contrast(${contrastPct}%) brightness(${brightnessPct}%)`;
      this.ctx.drawImage(this.pixelCanvas, 0, 0, this.width, this.height);
      this.ctx.filter = "none";
      this.drawScoreHud();
    }

    drawBackground() {
      const ctx = this.renderCtx;
      ctx.fillStyle = "#e6e6e6";
      ctx.fillRect(0, 0, this.width, this.height);

      ctx.fillStyle = "#dedede";
      ctx.beginPath();
      ctx.moveTo(0, this.height);
      ctx.lineTo(0, this.lineYAt(0));
      for (let x = 0; x <= this.width; x += 18) {
        ctx.lineTo(x, this.lineYAt(x));
      }
      ctx.lineTo(this.width, this.height);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = "#d4d4d4";
      ctx.lineWidth = 5;
      ctx.lineCap = "round";
      for (const mark of this.snowMarks) {
        const y = mark.y;
        ctx.beginPath();
        ctx.moveTo(mark.x, y);
        ctx.lineTo(mark.x + mark.length, y + 4);
        ctx.stroke();
      }
    }

    drawMountain() {
      const ctx = this.renderCtx;
      ctx.strokeStyle = "#d5d5d5";
      ctx.lineWidth = 5;
      ctx.lineCap = "round";
      ctx.beginPath();
      for (let x = 0; x <= this.width + 14; x += 18) {
        const y = this.mountainYAt(x);
        if (x === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    }

    drawMainSlope() {
      const ctx = this.renderCtx;
      ctx.strokeStyle = "#acacac";
      ctx.lineWidth = 5;
      ctx.lineCap = "butt";
      ctx.beginPath();
      for (let x = -20; x <= this.width + 20; x += 12) {
        const y = this.lineYAt(x);
        if (x === -20) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    }

    drawObstacles() {
      const ctx = this.renderCtx;
      ctx.fillStyle = "#b4b4b4";

      for (const obstacle of this.obstacles) {
        const x = obstacle.worldX - this.scroll;
        if (x < -90 || x > this.width + 90) {
          continue;
        }
        const w = obstacle.width;
        const h = obstacle.height;
        const leftX = x - w * 0.58;
        const rightX = x + w * 0.58;
        const baseYLeft = this.lineYAt(leftX);
        const baseYRight = this.lineYAt(rightX);
        const tip = x + w * obstacle.tipShift;
        const tipY = this.lineYAt(tip) - h;

        ctx.beginPath();
        ctx.moveTo(leftX, baseYLeft);
        ctx.lineTo(tip, tipY);
        ctx.lineTo(rightX, baseYRight);
        ctx.closePath();
        ctx.fill();
      }
    }

    drawSkier() {
      const ctx = this.renderCtx;
      const x = Math.round(this.width * this.playerXRatio);
      const y = Math.round(this.lineYAt(x) + this.player.airY);

      ctx.save();
      ctx.translate(x, y);
      if (this.state === "gameover") {
        ctx.rotate(this.player.crashTilt);
      } else if (this.player.backflipTriggered || this.player.backflipActive) {
        ctx.rotate(-this.player.backflipProgress);
      }

      if (this.skierImageLoaded) {
        const sway = this.state === "running" ? Math.sin(this.elapsed * 16) * 1.1 : 0;
        const width = 124;
        const height = 108;
        ctx.drawImage(
          this.skierImage,
          this.skierCrop.x,
          this.skierCrop.y,
          this.skierCrop.w,
          this.skierCrop.h,
          -64,
          -94 + sway,
          width,
          height
        );
      } else {
        this.drawSkierFallback(ctx);
      }

      ctx.restore();
    }

    drawSkierFallback(ctx) {
      ctx.strokeStyle = "#0a0a0a";
      ctx.fillStyle = "#0a0a0a";
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(-42, 10);
      ctx.lineTo(38, 10);
      ctx.stroke();

      ctx.fillRect(-26, -38, 20, 36);
      ctx.fillRect(-10, -40, 18, 40);
      ctx.beginPath();
      ctx.arc(-8, -52, 15, 0, Math.PI * 2);
      ctx.fill();
    }

    drawStormOverlay() {
      const ctx = this.renderCtx;
      const intensity = this.stormIntensity;
      if (intensity <= 0) {
        return;
      }

      ctx.save();

      ctx.globalAlpha = 0.16 * intensity;
      ctx.fillStyle = "#dfdfdf";
      ctx.fillRect(0, 0, this.width, this.height);

      const whiteout = ctx.createLinearGradient(this.width * 0.32, 0, this.width, this.height);
      whiteout.addColorStop(0, "rgba(232,232,232,0)");
      whiteout.addColorStop(0.7, `rgba(232,232,232,${0.22 * intensity})`);
      whiteout.addColorStop(1, `rgba(235,235,235,${0.65 * intensity})`);
      ctx.globalAlpha = 1;
      ctx.fillStyle = whiteout;
      ctx.fillRect(0, 0, this.width, this.height);

      const visibleCount = Math.floor(this.stormFlakes.length * (0.2 + 0.8 * intensity));
      for (let i = 0; i < visibleCount; i += 1) {
        const flake = this.stormFlakes[i];
        ctx.globalAlpha = clamp(0.1 + intensity * 0.48 * flake.depth, 0.08, 0.66);
        ctx.strokeStyle = "#f3f3f3";
        ctx.lineWidth = 1.5 + flake.depth * 1.4;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(flake.x, flake.y);
        ctx.lineTo(flake.x + flake.length * 0.72, flake.y + flake.length * 0.24);
        ctx.stroke();
      }

      ctx.globalAlpha = 0.2 * intensity;
      ctx.fillStyle = "#cfcfcf";
      ctx.fillRect(0, 0, this.width, this.height);
      ctx.restore();
    }

    drawScoreHud() {
      const ctx = this.renderCtx;
      const scale = clamp(this.height / 960, 0.8, 1.35);
      const fontSize = Math.round(22 * scale);
      const right = this.width - Math.round(22 * scale);
      const bottom = this.height - Math.round(20 * scale);
      const current = String(this.score).padStart(5, "0");
      const hi = String(this.highScore).padStart(5, "0");
      const label = `HI ${hi} ${current}`;

      ctx.fillStyle = "rgba(74, 74, 74, 0.92)";
      ctx.font = `700 ${fontSize}px "Courier New", "Andale Mono", monospace`;
      ctx.textAlign = "right";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(label, right, bottom);
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
    }

    readHighScore() {
      try {
        const raw = localStorage.getItem("skier_high_score");
        const parsed = raw ? Number.parseInt(raw, 10) : 0;
        return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
      } catch (_error) {
        return 0;
      }
    }

    persistHighScore(score) {
      try {
        localStorage.setItem("skier_high_score", String(score));
      } catch (_error) {
        // Ignore storage failures (private mode / disabled storage).
      }
    }
  }

  window.SkierGame = SkierGame;
  window.createSkierGame = function createSkierGame(canvas) {
    return new SkierGame(canvas);
  };
})();
