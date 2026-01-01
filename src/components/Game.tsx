import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { GAME_CONFIG, type GameState, type Bird, type Pipe } from '@/constants/gameConfig';
import { Trophy, RefreshCw, Play, Volume2, VolumeX, Brain, Zap, FastForward, Square } from 'lucide-react';
import { audioController } from '@/lib/audio';
import { toast } from 'sonner';
import { NeuralNetwork } from '@/lib/ai';

interface AIBird extends Bird {
  brain: NeuralNetwork;
  fitness: number;
  score: number;
  distance: number;
  alive: boolean;
  color: string;
}

type GameMode = 'PLAYER' | 'AI';

const Game: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<GameMode>('PLAYER');
  const [gameState, setGameState] = useState<GameState>('READY');
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  
  // AI Stats
  const [generation, setGeneration] = useState(1);
  const [aliveCount, setAliveCount] = useState(0);
  const [bestScore, setBestScore] = useState(0); // Best score of current gen
  const [gameSpeed, setGameSpeed] = useState(1);
  const [isAutopilot, setIsAutopilot] = useState(false);

  // Game State Refs
  const birdsRef = useRef<AIBird[]>([]); // Array to support multiple birds
  const pipesRef = useRef<Pipe[]>([]);
  const frameRef = useRef<number>(0);
  const lastPipeSpawnRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const accumulatorRef = useRef<number>(0);
  const scoreRef = useRef(0);
  const savedBrainsRef = useRef<NeuralNetwork[]>([]); // Store best brains

  const FIXED_TIME_STEP = 1000 / 60;

  // Load high score
  useEffect(() => {
    const saved = localStorage.getItem('flappy-highscore');
    if (saved) setHighScore(parseInt(saved, 10));
  }, []);

  // Initialize Birds
  const createPlayerBird = (): AIBird => {
    let brain;
    try {
      const saved = localStorage.getItem('flappy-ai-model');
      if (saved) {
        brain = NeuralNetwork.fromJSON(JSON.parse(saved));
      }
    } catch (e) {
      console.error('Failed to load AI model', e);
    }
    
    return {
      x: GAME_CONFIG.CANVAS_WIDTH / 3,
      y: GAME_CONFIG.CANVAS_HEIGHT / 2,
      velocity: 0,
      rotation: 0,
      brain: brain || new NeuralNetwork(4, 6, 1),
      fitness: 0,
      score: 0,
      distance: 0,
      alive: true,
      color: '#FACC15',
    };
  };

  const createAIBirds = (population: number, bestBrains: NeuralNetwork[] = []): AIBird[] => {
    const birds: AIBird[] = [];
    for (let i = 0; i < population; i++) {
      let brain: NeuralNetwork;
      let color = `hsla(${Math.random() * 360}, 70%, 50%, 0.6)`;
      
      if (bestBrains.length > 0) {
        // Evolution: Pick a random best brain
        // Elitism: Keep the very best one unchanged if it's the first index
        const parentBrain = bestBrains[i % bestBrains.length]; // Simple cycling
        brain = parentBrain.copy();
        if (i > 0) { // Keep the absolute best one pure (Elitism), mutate others
             brain.mutate(GAME_CONFIG.AI_MUTATION_RATE);
        } else {
             color = '#FF0000'; // Mark the champion
        }
      } else {
        brain = new NeuralNetwork(4, 6, 1);
      }

      birds.push({
        x: GAME_CONFIG.CANVAS_WIDTH / 3,
        y: GAME_CONFIG.CANVAS_HEIGHT / 2,
        velocity: 0,
        rotation: 0,
        brain,
        fitness: 0,
        score: 0,
        distance: 0,
        alive: true,
        color,
      });
    }
    return birds;
  };

  const resetGame = useCallback((newMode?: GameMode) => {
    const currentMode = newMode || mode;
    
    if (currentMode === 'PLAYER') {
      birdsRef.current = [createPlayerBird()];
      setAliveCount(1);
    } else {
      // AI Mode: Create population
      // If we have saved brains (next generation), use them. Otherwise fresh start.
      // But resetGame usually implies fresh start or user clicked restart.
      // For AI 'next generation', we will have a separate flow.
      birdsRef.current = createAIBirds(GAME_CONFIG.AI_POPULATION);
      setGeneration(1);
      setBestScore(0);
      setAliveCount(GAME_CONFIG.AI_POPULATION);
      savedBrainsRef.current = [];
    }

    pipesRef.current = [];
    scoreRef.current = 0;
    setScore(0);
    lastPipeSpawnRef.current = 0;
    setGameState('READY');
    lastTimeRef.current = 0;
    accumulatorRef.current = 0;
    
    // Initial draw
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) draw(ctx);
  }, [mode]);

  // Init game on mount
  useEffect(() => {
    resetGame();
  }, [resetGame]);

  const stopAndSave = useCallback(() => {
    const aliveBirds = birdsRef.current.filter(b => b.alive);
    if (aliveBirds.length > 0) {
        aliveBirds.sort((a, b) => b.fitness - a.fitness);
        const bestBird = aliveBirds[0];
        localStorage.setItem('flappy-ai-model', JSON.stringify(bestBird.brain.toJSON()));
        toast.success(`Training Stopped. Best Model Saved! (Score: ${bestBird.score})`);
    } else {
        toast.info("Training stopped.");
    }
    resetGame();
    setGameState('READY');
  }, [resetGame]);

  const nextGeneration = useCallback(() => {
    // 1. Calculate fitness
    // Simple fitness: score^2 (reward high scores more) or just score
    // Since score is integer, maybe add time lived?
    // Here we use score as primary fitness.
    
    // 2. Select best birds
    const birds = birdsRef.current; // These are all dead now, but contain data
    // Sort by fitness (Distance + Score)
    birds.sort((a, b) => b.fitness - a.fitness);
    
    const bestCount = 5; // Top 5 perform reproduction
    const bestBrains = birds.slice(0, bestCount).map(b => b.brain);
    
    savedBrainsRef.current = bestBrains;
    
    // 3. Save Best Brain
    if (bestBrains.length > 0) {
       localStorage.setItem('flappy-ai-model', JSON.stringify(bestBrains[0].toJSON()));
    }

    // 4. Create new birds
    birdsRef.current = createAIBirds(GAME_CONFIG.AI_POPULATION, bestBrains);
    
    // Reset Game State for next gen
    pipesRef.current = [];
    scoreRef.current = 0; // Current global score (visual only, AI tracks own score)
    setScore(0);
    lastPipeSpawnRef.current = 0;
    setGameState('PLAYING'); // Auto start
    setGeneration(g => g + 1);
    setAliveCount(GAME_CONFIG.AI_POPULATION);
    setBestScore(0);
    
    // Log
    console.log(`Generation ${generation + 1} started. Best score prev: ${birds[0].score}`);
  }, [generation]);

  const jump = useCallback(() => {
    // Only for player mode
    if (mode === 'AI') return;
    if (isAutopilot) return; // Block input in Autopilot mode
    if (!birdsRef.current[0]) return;

    if (gameState === 'PLAYING') {
      birdsRef.current[0].velocity = GAME_CONFIG.JUMP_STRENGTH;
      audioController.playJump();
    } else if (gameState === 'READY') {
      setGameState('PLAYING');
      birdsRef.current[0].velocity = GAME_CONFIG.JUMP_STRENGTH;
      audioController.playJump();
    }
  }, [gameState, mode]);

  const gameOver = useCallback(() => {
    // Only for player mode
    if (mode === 'AI') return;

    audioController.playDie();
    setGameState('GAME_OVER');
    if (scoreRef.current > highScore) {
      setHighScore(scoreRef.current);
      localStorage.setItem('flappy-highscore', scoreRef.current.toString());
    }
  }, [highScore, mode]);

  const update = useCallback(() => {
    // Find closest pipe (target for AI)
    let closestPipe = pipesRef.current.find(pipe => 
        pipe.x + GAME_CONFIG.PIPE_WIDTH > birdsRef.current[0]?.x - GAME_CONFIG.BIRD_RADIUS
    );

    // If no pipe found (start of game), create a virtual target
    if (!closestPipe) {
        closestPipe = {
            x: GAME_CONFIG.CANVAS_WIDTH,
            topHeight: GAME_CONFIG.CANVAS_HEIGHT / 2 - GAME_CONFIG.PIPE_GAP / 2, // Center gap
            passed: false
        };
    }

    // Update all alive birds
    let anyAlive = false;
    let currentGenBestScore = 0;

    birdsRef.current.forEach(bird => {
      if (!bird.alive) return;
      anyAlive = true;

      // Update distance (Survival Reward)
      bird.distance += GAME_CONFIG.PIPE_SPEED;
      // Calculate Fitness: Distance + Huge Bonus for Score
      bird.fitness = bird.distance + (bird.score * 5000);

      // 1. AI Decision (AI Mode OR Autopilot)
      if ((mode === 'AI' || (mode === 'PLAYER' && isAutopilot)) && closestPipe) {
        // Optimized Inputs (4 features):
        // 1. Bird Y (0-1)
        // 2. Velocity (normalized)
        // 3. Distance to Pipe (normalized)
        // 4. Vertical Distance to Gap Center (normalized)
        
        const gapCenterY = closestPipe.topHeight + GAME_CONFIG.PIPE_GAP / 2;
        
        const inputs = [
          bird.y / GAME_CONFIG.CANVAS_HEIGHT,
          (bird.velocity + 20) / 40, // Map -20..20 to 0..1
          (closestPipe.x + GAME_CONFIG.PIPE_WIDTH - bird.x) / GAME_CONFIG.CANVAS_WIDTH, // Dist to pipe END
          (bird.y - gapCenterY) / GAME_CONFIG.CANVAS_HEIGHT + 0.5 // Vertical diff to target
        ];
        
        const output = bird.brain.predict(inputs);
        if (output[0] > 0.5) {
          bird.velocity = GAME_CONFIG.JUMP_STRENGTH;
        }
      }

      // 2. Physics
      bird.velocity += GAME_CONFIG.GRAVITY;
      bird.y += bird.velocity;
      
      // Rotation
      bird.rotation = Math.min(Math.PI / 4, Math.max(-Math.PI / 4, (bird.velocity * 0.1)));

      // 3. Collision
      // Ground
      if (bird.y + GAME_CONFIG.BIRD_RADIUS >= GAME_CONFIG.CANVAS_HEIGHT - GAME_CONFIG.GROUND_HEIGHT) {
        bird.alive = false;
      }
      // Ceiling
      if (bird.y - GAME_CONFIG.BIRD_RADIUS <= 0) {
        bird.y = GAME_CONFIG.BIRD_RADIUS;
        bird.velocity = 0;
      }

      // Pipe Collision
      for (const pipe of pipesRef.current) {
         if (
            bird.x + GAME_CONFIG.BIRD_RADIUS > pipe.x &&
            bird.x - GAME_CONFIG.BIRD_RADIUS < pipe.x + GAME_CONFIG.PIPE_WIDTH
         ) {
             if (
               bird.y - GAME_CONFIG.BIRD_RADIUS < pipe.topHeight ||
               bird.y + GAME_CONFIG.BIRD_RADIUS > pipe.topHeight + GAME_CONFIG.PIPE_GAP
             ) {
                bird.alive = false;
             }
         }
      }
      
      // Update max score for this gen
      if (bird.score > currentGenBestScore) {
          currentGenBestScore = bird.score;
      }
    });
    
    if (mode === 'AI') {
        setBestScore(currentGenBestScore);
        const living = birdsRef.current.filter(b => b.alive).length;
        setAliveCount(living);
        if (living === 0) {
            nextGeneration();
            return;
        }
    } else {
        // Player Mode: If bird dead, game over
        if (!birdsRef.current[0] || !birdsRef.current[0].alive) {
            gameOver();
            return;
        }
    }

    // Pipe Logic (Global for the world)
    lastPipeSpawnRef.current++;
    if (lastPipeSpawnRef.current > GAME_CONFIG.PIPE_SPAWN_RATE) {
      const minPipeH = 50;
      const maxPipeH = GAME_CONFIG.CANVAS_HEIGHT - GAME_CONFIG.GROUND_HEIGHT - GAME_CONFIG.PIPE_GAP - minPipeH;
      const topHeight = Math.floor(Math.random() * (maxPipeH - minPipeH + 1)) + minPipeH;
      
      pipesRef.current.push({
        x: GAME_CONFIG.CANVAS_WIDTH,
        topHeight,
        passed: false,
      });
      lastPipeSpawnRef.current = 0;
    }

    // Move Pipes & Score
    for (let i = pipesRef.current.length - 1; i >= 0; i--) {
      const pipe = pipesRef.current[i];
      pipe.x -= GAME_CONFIG.PIPE_SPEED;

      if (pipe.x + GAME_CONFIG.PIPE_WIDTH < 0) {
        pipesRef.current.splice(i, 1);
        continue;
      }

      // Score counting
      // In AI mode, each bird tracks its own score?
      // Or we just track when pipe passes x coordinate of birds (since all birds have same x)
      if (!pipe.passed && birdsRef.current[0].x > pipe.x + GAME_CONFIG.PIPE_WIDTH) {
        pipe.passed = true;
        
        // Update score for all alive birds
        birdsRef.current.forEach(bird => {
           if (bird.alive) {
               bird.score += 1;
           }
        });
        
        // Update UI score
        const maxScore = Math.max(...birdsRef.current.map(b => b.score));
        scoreRef.current = maxScore;
        setScore(maxScore);
        
        if (mode === 'PLAYER') {
             audioController.playScore();
        }
      }
    }

  }, [mode, isAutopilot, gameOver, nextGeneration]);

  const draw = useCallback((ctx: CanvasRenderingContext2D) => {
    ctx.clearRect(0, 0, GAME_CONFIG.CANVAS_WIDTH, GAME_CONFIG.CANVAS_HEIGHT);

    // Background
    const gradient = ctx.createLinearGradient(0, 0, 0, GAME_CONFIG.CANVAS_HEIGHT);
    gradient.addColorStop(0, '#7DD3FC');
    gradient.addColorStop(1, '#BAE6FD');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, GAME_CONFIG.CANVAS_WIDTH, GAME_CONFIG.CANVAS_HEIGHT);

    // Pipes
    ctx.lineWidth = 2;
    pipesRef.current.forEach(pipe => {
      ctx.fillStyle = '#22C55E';
      ctx.strokeStyle = '#14532D';
      
      // Top
      ctx.fillRect(pipe.x, 0, GAME_CONFIG.PIPE_WIDTH, pipe.topHeight);
      ctx.strokeRect(pipe.x, 0, GAME_CONFIG.PIPE_WIDTH, pipe.topHeight);
      
      // Bottom
      const bottomY = pipe.topHeight + GAME_CONFIG.PIPE_GAP;
      const bottomH = GAME_CONFIG.CANVAS_HEIGHT - GAME_CONFIG.GROUND_HEIGHT - bottomY;
      ctx.fillRect(pipe.x, bottomY, GAME_CONFIG.PIPE_WIDTH, bottomH);
      ctx.strokeRect(pipe.x, bottomY, GAME_CONFIG.PIPE_WIDTH, bottomH);
      
      // Caps
      const capH = 20;
      ctx.fillRect(pipe.x - 2, pipe.topHeight - capH, GAME_CONFIG.PIPE_WIDTH + 4, capH);
      ctx.strokeRect(pipe.x - 2, pipe.topHeight - capH, GAME_CONFIG.PIPE_WIDTH + 4, capH);
      ctx.fillRect(pipe.x - 2, bottomY, GAME_CONFIG.PIPE_WIDTH + 4, capH);
      ctx.strokeRect(pipe.x - 2, bottomY, GAME_CONFIG.PIPE_WIDTH + 4, capH);
    });

    // Ground
    ctx.fillStyle = '#D6D3D1';
    ctx.fillRect(0, GAME_CONFIG.CANVAS_HEIGHT - GAME_CONFIG.GROUND_HEIGHT, GAME_CONFIG.CANVAS_WIDTH, GAME_CONFIG.GROUND_HEIGHT);
    ctx.fillStyle = '#78716C';
    ctx.fillRect(0, GAME_CONFIG.CANVAS_HEIGHT - GAME_CONFIG.GROUND_HEIGHT, GAME_CONFIG.CANVAS_WIDTH, 10);
    
    // Birds
    birdsRef.current.forEach(bird => {
       if (!bird.alive) return;
       
       ctx.save();
       ctx.translate(bird.x, bird.y);
       ctx.rotate(bird.rotation);
       
       // Opacity for AI mode to see layers
       ctx.globalAlpha = mode === 'AI' ? 0.6 : 1.0;
       
       // Body
       ctx.beginPath();
       ctx.arc(0, 0, GAME_CONFIG.BIRD_RADIUS, 0, Math.PI * 2);
       ctx.fillStyle = bird.color || '#FACC15';
       ctx.fill();
       ctx.lineWidth = 2;
       ctx.strokeStyle = '#854D0E';
       ctx.stroke();

       // Eye & Wing (simplified for performance in AI mode)
       if (mode === 'PLAYER' || birdsRef.current.length < 10 || bird.color === '#FF0000') {
           ctx.beginPath();
           ctx.arc(6, -6, 6, 0, Math.PI * 2);
           ctx.fillStyle = 'white';
           ctx.fill();
           ctx.stroke();
           ctx.beginPath();
           ctx.arc(8, -6, 2, 0, Math.PI * 2);
           ctx.fillStyle = 'black';
           ctx.fill();
           
           ctx.beginPath();
           ctx.ellipse(-4, 4, 8, 5, 0, 0, Math.PI * 2);
           ctx.fillStyle = '#FDE047';
           ctx.fill();
           ctx.stroke();
           
           ctx.beginPath();
           ctx.fillStyle = '#F97316';
           ctx.moveTo(8, 2);
           ctx.lineTo(16, 6);
           ctx.lineTo(8, 10);
           ctx.fill();
           ctx.stroke();
       }
       
       ctx.restore();
    });

  }, [mode]);

  // Main Loop
  const loop = useCallback((time: number) => {
    if (lastTimeRef.current === 0) lastTimeRef.current = time;
    const deltaTime = time - lastTimeRef.current;
    lastTimeRef.current = time;
    
    accumulatorRef.current += deltaTime;
    if (accumulatorRef.current > 200) accumulatorRef.current = 200;

    // Apply speed multiplier for AI training
    const iterations = mode === 'AI' ? gameSpeed : 1;
    
    for (let i = 0; i < iterations; i++) {
        while (accumulatorRef.current >= FIXED_TIME_STEP) {
          if (gameState === 'PLAYING') {
            update();
          }
          accumulatorRef.current -= FIXED_TIME_STEP;
        }
        // If accelerated, we might need to "fake" accumulator reset to process multiple updates per frame
        // But the robust way is:
        if (iterations > 1 && gameState === 'PLAYING') {
             // For speedup, we force extra updates ignoring accumulator constraint
             // Or better: just call update() multiple times?
             // Standard accumulator pattern ties physics to time.
             // To speed up: artificially increase deltaTime? Or just run update logic N times.
             // Let's run update N times directly if we have "extra" time logic, but here we just want to Fast Forward.
        }
    }
    
    // Quick and dirty speed up: Run the physics step N times per frame regardless of time?
    // No, that breaks physics speed. We want "Time Scale".
    // Correct way:
    // If speed is 2x, we pretend 2 * deltaTime passed.
    
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) draw(ctx);

    if (gameState !== 'GAME_OVER' || mode === 'AI') { // AI never truly "Game Over", just Next Gen
      frameRef.current = requestAnimationFrame(loop);
    }
  }, [gameState, update, draw, FIXED_TIME_STEP, mode, gameSpeed]);
  
  // Revised Loop for Speed Control
  useEffect(() => {
     const loopWrapper = (time: number) => {
        if (lastTimeRef.current === 0) lastTimeRef.current = time;
        // Apply Game Speed to Delta Time
        const realDelta = time - lastTimeRef.current;
        const scaledDelta = realDelta * gameSpeed; // Virtual time passes faster
        lastTimeRef.current = time;
        
        accumulatorRef.current += scaledDelta;
        
        // Safety cap
        if (accumulatorRef.current > 500 * gameSpeed) accumulatorRef.current = 500 * gameSpeed;

        while (accumulatorRef.current >= FIXED_TIME_STEP) {
             if (gameState === 'PLAYING') update();
             accumulatorRef.current -= FIXED_TIME_STEP;
        }
        
        const ctx = canvasRef.current?.getContext('2d');
        if (ctx) draw(ctx);
        
        // AI mode handles "Game Over" internally (Next Gen), so we keep looping if AI
        // Player mode stops loop on Game Over
        if (mode === 'AI' || gameState !== 'GAME_OVER') {
            frameRef.current = requestAnimationFrame(loopWrapper);
        }
     };
     
     frameRef.current = requestAnimationFrame(loopWrapper);
     return () => cancelAnimationFrame(frameRef.current);
  }, [gameState, update, draw, gameSpeed, mode, FIXED_TIME_STEP]);

  // Input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (mode === 'AI') return;

      if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyF') {
        e.preventDefault();
        jump();
      }
      if (e.code === 'KeyR' && gameState === 'GAME_OVER') {
        resetGame();
      }
      if (mode === 'PLAYER' && gameState === 'PLAYING') {
         if (e.code === 'KeyA') setIsAutopilot(true);
         if (e.code === 'KeyI') setIsAutopilot(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [jump, gameState, resetGame, mode]);

  const toggleMode = () => {
     const newMode = mode === 'PLAYER' ? 'AI' : 'PLAYER';
     setMode(newMode);
     setGameState('READY');
     setGeneration(1);
     setGameSpeed(1);
     setBestScore(0);
     // Trigger reset with new mode immediately
     // We need to pass newMode because state update is async
     // But resetGame uses 'mode' from closure or ref? 'mode' is in dep array.
     // Better:
     setTimeout(() => resetGame(newMode), 0);
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 dark:bg-slate-950 p-4 gap-4">
      {/* Control Panel */}
      <div className="flex gap-4 items-center mb-2">
         <Button 
            variant={mode === 'PLAYER' ? 'default' : 'outline'}
            onClick={() => mode !== 'PLAYER' && toggleMode()}
            className="w-32"
         >
            Player
         </Button>
         <Button 
            variant={mode === 'AI' ? 'default' : 'outline'}
            onClick={() => mode !== 'AI' && toggleMode()}
            className="w-32 gap-2"
         >
            <Brain className="w-4 h-4" /> AI Training
         </Button>
      </div>

      <Card className="relative overflow-hidden shadow-2xl border-4 border-slate-800 rounded-xl">
        <canvas
          ref={canvasRef}
          width={GAME_CONFIG.CANVAS_WIDTH}
          height={GAME_CONFIG.CANVAS_HEIGHT}
          className="block bg-sky-300 cursor-pointer touch-none"
          onClick={() => jump()}
          onTouchStart={(e) => { e.preventDefault(); jump(); }}
        />

        {/* Score & AI Stats Overlay */}
        <div className="absolute top-0 left-0 w-full p-4 pointer-events-none z-10 flex justify-between items-start">
             <div className="flex flex-col gap-1">
                 {mode === 'AI' && (
                     <div className="bg-black/50 backdrop-blur-md text-white p-3 rounded-lg text-sm font-mono space-y-1">
                        <div className="font-bold text-yellow-400 mb-1">AI TRAINING</div>
                        <div>Gen: <span className="text-xl font-bold">{generation}</span></div>
                        <div>Alive: <span className="text-green-400">{aliveCount}</span>/{GAME_CONFIG.AI_POPULATION}</div>
                        <div>Best: {bestScore}</div>
                     </div>
                 )}
             </div>
             
             <div className="flex flex-col items-end gap-2">
                 <div className="font-black text-6xl text-white drop-shadow-[0_4px_4px_rgba(0,0,0,0.5)] select-none">
                   {score}
                 </div>
                 {mode === 'AI' && (
                     <div className="flex gap-1 pointer-events-auto">
                        <Button 
                            size="sm" variant={gameSpeed === 1 ? 'default' : 'secondary'} 
                            onClick={() => setGameSpeed(1)} className="h-8 w-8 p-0"
                        >1x</Button>
                        <Button 
                            size="sm" variant={gameSpeed === 2 ? 'default' : 'secondary'} 
                            onClick={() => setGameSpeed(2)} className="h-8 w-8 p-0"
                        ><Zap className="w-4 h-4" /></Button>
                        <Button 
                            size="sm" variant={gameSpeed === 10 ? 'default' : 'secondary'} 
                            onClick={() => setGameSpeed(10)} className="h-8 w-8 p-0"
                        ><FastForward className="w-4 h-4" /></Button>
                        <div className="w-px h-8 bg-white/20 mx-1" />
                        <Button 
                            size="sm" variant="destructive" 
                            onClick={stopAndSave} className="h-8 w-auto px-3 font-bold text-xs gap-2"
                        ><Square className="w-3 h-3 fill-current" /> STOP & SAVE</Button>
                     </div>
                 )}
             </div>
        </div>
        
        {/* Mute Button */}
        <Button
          variant="secondary"
          size="icon"
          className="absolute bottom-4 right-4 z-20 bg-white/80 backdrop-blur-sm hover:bg-white border-2 border-slate-800 rounded-full w-10 h-10 shadow-md"
          onClick={(e) => {
            e.stopPropagation();
            const muted = audioController.toggleMute();
            setIsMuted(!muted);
          }}
        >
          {isMuted ? <VolumeX className="w-5 h-5 text-slate-800" /> : <Volume2 className="w-5 h-5 text-slate-800" />}
        </Button>

        {/* Ready State Overlay (Player Mode Only) */}
        {mode === 'PLAYER' && gameState === 'READY' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/30 backdrop-blur-[2px]">
            <Card className="p-8 flex flex-col items-center gap-6 bg-white/95 shadow-xl border-4 border-slate-800 animate-in zoom-in-95">
              <div className="text-center">
                <h1 className="text-4xl font-black text-slate-800 mb-2 tracking-tight">FLAPPY<br/>CLONE</h1>
                <p className="text-slate-500 font-medium">Space / F to Jump</p>
              </div>
              <Button size="lg" onClick={() => jump()} className="w-full text-lg font-bold h-14 bg-green-500 hover:bg-green-600 text-white shadow-[0_4px_0_#15803d] active:shadow-none active:translate-y-1 transition-all">
                <Play className="mr-2 h-6 w-6" /> START GAME
              </Button>
            </Card>
          </div>
        )}

        {/* Game Over Overlay (Player Mode Only) */}
        {mode === 'PLAYER' && gameState === 'GAME_OVER' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-300">
            <Card className="p-8 flex flex-col items-center gap-6 bg-white shadow-2xl border-4 border-slate-800 animate-in slide-in-from-bottom-10">
              <div className="text-center space-y-1">
                <h2 className="text-3xl font-black text-slate-800 uppercase tracking-wider">Game Over</h2>
                <div className="flex items-center justify-center gap-8 py-4">
                  <div className="text-center">
                    <p className="text-xs font-bold text-slate-400 uppercase">Score</p>
                    <p className="text-4xl font-black text-slate-800">{score}</p>
                  </div>
                  <div className="w-px h-12 bg-slate-200" />
                  <div className="text-center">
                    <p className="text-xs font-bold text-slate-400 uppercase">Best</p>
                    <p className="text-4xl font-black text-amber-500 flex items-center justify-center gap-1">
                      <Trophy className="w-6 h-6" /> {highScore}
                    </p>
                  </div>
                </div>
              </div>
              
              <div className="flex gap-4 w-full">
                <Button 
                  size="lg" 
                  onClick={() => resetGame()} 
                  className="flex-1 text-lg font-bold h-14 bg-sky-500 hover:bg-sky-600 text-white shadow-[0_4px_0_#0369a1] active:shadow-none active:translate-y-1 transition-all"
                >
                  <RefreshCw className="mr-2 h-5 w-5" /> RESTART (R)
                </Button>
              </div>
            </Card>
          </div>
        )}
        
        {/* AI Start Overlay */}
        {mode === 'AI' && gameState === 'READY' && (
             <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/30 backdrop-blur-[2px]">
                <Card className="p-8 flex flex-col items-center gap-6 bg-white/95 shadow-xl border-4 border-slate-800 animate-in zoom-in-95">
                  <div className="text-center max-w-xs">
                    <h1 className="text-3xl font-black text-slate-800 mb-2">NEURO<br/>EVOLUTION</h1>
                    <p className="text-slate-500 font-medium text-sm">
                        Watch {GAME_CONFIG.AI_POPULATION} neural networks learn to play through natural selection.
                    </p>
                  </div>
                  <Button 
                    size="lg" 
                    onClick={() => {
                        resetGame();
                        setGameState('PLAYING');
                    }} 
                    className="w-full text-lg font-bold h-14 bg-purple-600 hover:bg-purple-700 text-white shadow-[0_4px_0_#581c87] active:shadow-none active:translate-y-1 transition-all"
                  >
                    <Brain className="mr-2 h-6 w-6" /> START TRAINING
                  </Button>
                </Card>
              </div>
        )}
      </Card>
      
      {mode === 'PLAYER' && (
        <div className="mt-2 text-center space-y-1">
            <p className="text-slate-400 font-medium text-sm">
                Space / F / Click to Fly · R to Restart
            </p>
            <p className="text-slate-500 text-xs">
                Press <kbd className="font-bold text-slate-700">A</kbd> for AI Autopilot · <kbd className="font-bold text-slate-700">I</kbd> for Manual Control
            </p>
            {isAutopilot && <span className="inline-block px-2 py-0.5 rounded bg-purple-100 text-purple-700 text-xs font-bold animate-pulse">🤖 AI AUTOPILOT ACTIVE</span>}
        </div>
      )}
    </div>
  );
};

export default Game;
