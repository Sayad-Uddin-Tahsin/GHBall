const fs = require('fs');

// --- 1. PARSE COMMAND-LINE ARGUMENTS ---
const args = process.argv.slice(2);
let GITHUB_USERNAME = null;
let BALL_SPEED = 400;
let MAX_MISS = 3;
let theme = 'auto';
let showScore = false;

function printHelp() {
  console.log(`
Usage: node index.js --username <username> [options]

Options:
  --username <username>   GitHub username (required)
  --speed <number>        Ball speed in pixels/second (default: 400)
  --max-miss <number>     Max misses before forcing a guaranteed hit (default: 3)
  --theme light|dark|auto Colour theme (default: light). 'auto' adapts to system preference.
  --score                 Show a live score counter (top-right)
  --help                  Show this help message

Example:
  node index.js --username torvalds --speed 500 --max-miss 2 --theme dark --score
`);
  process.exit(0);
}

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--help') {
    printHelp();
  } else if (args[i] === '--username' && i + 1 < args.length) {
    GITHUB_USERNAME = args[++i];
  } else if (args[i] === '--speed' && i + 1 < args.length) {
    BALL_SPEED = parseInt(args[++i], 10);
  } else if (args[i] === '--max-miss' && i + 1 < args.length) {
    MAX_MISS = parseInt(args[++i], 10);
  } else if (args[i] === '--theme' && i + 1 < args.length) {
    theme = args[++i];
    if (!['light', 'dark', 'auto'].includes(theme)) {
      console.error('❌ Error: --theme must be "light", "dark", or "auto".');
      process.exit(1);
    }
  } else if (args[i] === '--score') {
    showScore = true;
  }
}

if (!GITHUB_USERNAME) {
  console.error('❌ Error: --username is required.');
  printHelp();
}

// --- 2. CONFIGURATION ---
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
if (!GITHUB_TOKEN) {
  console.error('❌ Error: GITHUB_TOKEN environment variable is required.');
  console.error('   For local: export GITHUB_TOKEN=your_token');
  console.error('   For Actions: uses ${{ secrets.GITHUB_TOKEN }} (free!)');
  process.exit(1);
}

const COLORS_LIGHT = { 0: '#ffffff', 1: '#9be9a8', 2: '#40c463', 3: '#30a14e', 4: '#216e39' };
const COLORS_DARK = { 0: '#2d333b', 1: '#9be9a8', 2: '#40c463', 3: '#30a14e', 4: '#216e39' };

const THEMES = {
  light: { bg: '#ffffff', text: '#24292f', paddle: '#24292f', ball: '#0969da', colors: COLORS_LIGHT },
  dark: { bg: '#1e1e1e', text: '#f0f6fc', paddle: '#f0f6fc', ball: '#58a6ff', colors: COLORS_DARK }
};

// We'll keep currentTheme for non-auto modes
const currentTheme = THEMES[theme] || THEMES.light;
const COLORS = currentTheme.colors;

const CELL = 14, GAP = 3, STEP = CELL + GAP, RADIUS = 6;
const PADDLE_WIDTH = 80, PADDLE_HALF = PADDLE_WIDTH / 2;
const MAX_OFFSET = 30, MAX_ANGLE_DEG = 70;
const MAX_ANGLE_RAD = MAX_ANGLE_DEG * Math.PI / 180;
const STEP_SIZE = 1;
const SVG_W = 913, SVG_H = 280, PADDLE_Y = 244, CENTER_X = SVG_W / 2;
const MAX_STEPS_PER_VOLLEY = 100000;

// --- FAST RAYCAST SIMULATOR FOR GUARANTEED HITS ---
function canHitAnyBrick(startX, startY, vx, vy, bricks) {
  let bx = startX, by = startY;
  let svx = vx, svy = vy;
  for (let s = 0; s < 3000; s++) {
    bx += svx;
    by += svy;
    if (by >= PADDLE_Y) return false;
    if (bx - RADIUS < 0) { bx = RADIUS; svx = -svx; }
    else if (bx + RADIUS > SVG_W) { bx = SVG_W - RADIUS; svx = -svx; }
    if (by - RADIUS < 0) { by = RADIUS; svy = -svy; }

    for (let i = 0; i < bricks.length; i++) {
      let b = bricks[i];
      if (bx + RADIUS > b.x && bx - RADIUS < b.x + CELL && by + RADIUS > b.y && by - RADIUS < b.y + CELL) {
        return true;
      }
    }
  }
  return false;
}

function scanForHitOffset(startX, startY, bricks) {
  for (let step = -PADDLE_HALF; step <= PADDLE_HALF; step += 2) {
    let testAngle = (step / PADDLE_HALF) * MAX_ANGLE_RAD;
    let testVx = Math.sin(testAngle);
    let testVy = -Math.cos(testAngle);
    if (canHitAnyBrick(startX, startY, testVx, testVy, bricks)) {
      return step;
    }
  }
  return null;
}

// --- 3. GITHUB GRAPHQL DATA FETCHER ---
async function fetchContributions(username) {
  const query = `
    query {
      user(login: "${username}") {
        contributionsCollection {
          contributionCalendar {
            weeks { contributionDays { contributionCount date } }
          }
        }
      }
    }
  `;

  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${GITHUB_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query })
  });

  const data = await response.json();
  if (data.errors) throw new Error(data.errors[0].message);
  return data.data.user.contributionsCollection.contributionCalendar.weeks;
}

function getLevel(count) {
  if (count === 0) return 0;
  if (count <= 4) return 1;
  if (count <= 14) return 2;
  if (count <= 29) return 3;
  return 4;
}

// --- 4. MAIN SVG GENERATOR ---
function generateDXBallSVG(weeks, speed, theme, showScore) {
  const numCols = weeks.length;
  const topPadding = showScore ? 40 : 20;
  const totalWidth = (numCols - 1) * STEP + CELL;
  const OFFSET_X = Math.floor((SVG_W - totalWidth) / 2), OFFSET_Y = topPadding;

  let staticGridSVG = `<g class="static-grid">\n`;
  let activeBricks = [];
  let brickIdCounter = 0;

  weeks.forEach((week, colIndex) => {
    week.contributionDays.forEach((day, rowIndex) => {
      const level = getLevel(day.contributionCount);
      const x = OFFSET_X + colIndex * STEP;
      const y = OFFSET_Y + rowIndex * STEP;

      if (level === 0) {
        staticGridSVG += `    <rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" class="lv0" />\n`;
      } else {
        brickIdCounter++;
        activeBricks.push({ id: brickIdCounter, x, y, level, col: colIndex, row: rowIndex });
      }
    });
  });
  staticGridSVG += `  </g>\n`;

  const masterBrickList = [...activeBricks];

  let ballX = CENTER_X, ballY = PADDLE_Y - 10;
  let vx = 0, vy = -1;
  let currentPaddleX = CENTER_X - PADDLE_HALF;
  let cumulativeDist = 0;
  let pathEvents = [];
  let brickHitEvents = [];

  let isFirstVolley = true;
  let volleyCounter = 0;
  let missedVolleys = 0;

  pathEvents.push({ x: ballX, y: ballY, paddleX: currentPaddleX, type: 'start', dist: 0 });

  while (activeBricks.length > 0) {
    volleyCounter++;
    const bricksAtStartOfVolley = activeBricks.length;

    if (isFirstVolley) {
      vx = 0; vy = -1; isFirstVolley = false;
    } else {
      ballY = PADDLE_Y - 10;
    }

    const volleyStartDist = cumulativeDist;
    const startPaddleX = currentPaddleX;
    let volleyPoints = [];
    let stepCounter = 0;
    let apexDist = volleyStartDist;

    while (ballY < PADDLE_Y) {
      stepCounter++;
      if (stepCounter > MAX_STEPS_PER_VOLLEY) break;

      ballX += vx * STEP_SIZE;
      ballY += vy * STEP_SIZE;
      cumulativeDist += STEP_SIZE;

      if (ballX - RADIUS < 0) { ballX = RADIUS; vx = -vx; volleyPoints.push({ x: ballX, y: ballY, type: 'wall', dist: cumulativeDist }); }
      else if (ballX + RADIUS > SVG_W) { ballX = SVG_W - RADIUS; vx = -vx; volleyPoints.push({ x: ballX, y: ballY, type: 'wall', dist: cumulativeDist }); }

      if (ballY - RADIUS < 0) {
        ballY = RADIUS; vy = -vy;
        apexDist = cumulativeDist;
        volleyPoints.push({ x: ballX, y: ballY, type: 'ceiling', dist: cumulativeDist });
      }

      let hitIdx = activeBricks.findIndex(b => {
        return (ballX + RADIUS > b.x && ballX - RADIUS < b.x + CELL && ballY + RADIUS > b.y && ballY - RADIUS < b.y + CELL);
      });

      if (hitIdx !== -1) {
        const b = activeBricks[hitIdx];
        const overlapX = Math.min(ballX + RADIUS, b.x + CELL) - Math.max(ballX - RADIUS, b.x);
        const overlapY = Math.min(ballY + RADIUS, b.y + CELL) - Math.max(ballY - RADIUS, b.y);

        if (overlapX < overlapY) {
          vx = -vx; ballX = (vx > 0) ? b.x + CELL + RADIUS : b.x - RADIUS;
        } else {
          vy = -vy; ballY = (vy > 0) ? b.y + CELL + RADIUS : b.y - RADIUS;
        }

        apexDist = cumulativeDist;
        activeBricks.splice(hitIdx, 1);
        brickHitEvents.push({ brickId: b.id, dist: cumulativeDist });
        volleyPoints.push({ x: ballX, y: ballY, type: 'hit', brick: b, dist: cumulativeDist });
      }
    }

    // Reset miss streak when a brick is destroyed!
    if (activeBricks.length < bricksAtStartOfVolley) {
      missedVolleys = 0;
    } else {
      missedVolleys++;
    }

    ballY = PADDLE_Y;
    const ballXAtPaddle = ballX;

    let rawOffset;

    // Check if MAX_MISS limit was hit
    if (missedVolleys >= MAX_MISS && activeBricks.length > 0) {
      let guaranteedOffset = scanForHitOffset(ballXAtPaddle, PADDLE_Y - 10, activeBricks);
      if (guaranteedOffset !== null) {
        rawOffset = guaranteedOffset;
      } else {
        rawOffset = (Math.random() * 2 - 1) * MAX_OFFSET;
      }
    } else {
      // Natural random probability
      rawOffset = (Math.random() * 2 - 1) * MAX_OFFSET;
    }

    const offset = Math.min(Math.max(rawOffset, -PADDLE_HALF), PADDLE_HALF);
    let newPaddleX = Math.max(0, Math.min(SVG_W - PADDLE_WIDTH, (ballXAtPaddle - offset) - PADDLE_HALF));

    const angle = (offset / PADDLE_HALF) * MAX_ANGLE_RAD;
    const newVx = Math.sin(angle);
    const newVy = -Math.cos(angle);

    // --- PADDLE MOVES ONLY AFTER APEX/HIT ---
    const volleyEndDist = cumulativeDist;
    volleyPoints.forEach(pt => {
      let ptPaddleX;
      if (pt.dist <= apexDist) {
        ptPaddleX = startPaddleX; // Hold position while ball goes up
      } else {
        const frac = (pt.dist - apexDist) / (volleyEndDist - apexDist);
        ptPaddleX = startPaddleX + (newPaddleX - startPaddleX) * frac; // Move during descent
      }
      pathEvents.push({ x: pt.x, y: pt.y, paddleX: ptPaddleX, type: pt.type, dist: pt.dist });
    });

    pathEvents.push({ x: ballXAtPaddle, y: PADDLE_Y, paddleX: newPaddleX, type: 'paddle', dist: cumulativeDist });
    currentPaddleX = newPaddleX; vx = newVx; vy = newVy; ballX = ballXAtPaddle; ballY = PADDLE_Y - 10;
  }

  // --- Center the Paddle and Ball ---
  cumulativeDist += (speed * 1.5);
  pathEvents.push({
    x: CENTER_X,
    y: PADDLE_Y,
    paddleX: CENTER_X - PADDLE_HALF,
    type: 'end-center',
    dist: cumulativeDist
  });

  cumulativeDist += (speed * 1.5);
  pathEvents.push({
    x: CENTER_X,
    y: PADDLE_Y,
    paddleX: CENTER_X - PADDLE_HALF,
    type: 'end-pause',
    dist: cumulativeDist
  });

  const totalDistance = cumulativeDist;
  const animDuration = totalDistance / speed;

  let ballKeyframes = '';
  let paddleKeyframes = '';

  pathEvents.forEach(ev => {
    const pctStr = ((ev.dist / totalDistance) * 100).toFixed(3) + '%';
    ballKeyframes += `        ${pctStr} { transform: translate(${ev.x.toFixed(1)}px, ${ev.y.toFixed(1)}px); }\n`;
    paddleKeyframes += `        ${pctStr} { transform: translateX(${ev.paddleX.toFixed(1)}px); }\n`;
  });

  let breakKeyframes = '';
  masterBrickList.forEach(b => {
    const hitEvent = brickHitEvents.find(e => e.brickId === b.id);
    if (hitEvent) {
      const hitPct = (hitEvent.dist / totalDistance) * 100;
      breakKeyframes += `
      @keyframes break-${b.id} {
        0% { opacity: 1; transform: scale(1); }
        ${hitPct.toFixed(3)}% { opacity: 0; transform: scale(0); }
        100% { opacity: 0; transform: scale(0); }
      }
      .hit-${b.id} { animation: break-${b.id} ${animDuration}s infinite step-end; transform-origin: ${(b.x + 7).toFixed(1)}px ${(b.y + 7).toFixed(1)}px; }`;
    }
  });

  let scoreElements = '', scoreKeyframes = '';
  if (showScore) {
    const numBricks = masterBrickList.length;
    const allPcts = [0, ...brickHitEvents.map(e => (e.dist / totalDistance) * 100), 100];

    for (let i = 0; i <= numBricks; i++) {
      const startPct = allPcts[i], endPct = allPcts[i + 1];
      if (startPct === endPct && i !== numBricks) continue;

      scoreKeyframes += `
      @keyframes score-${i} {
        0% { opacity: ${i === 0 ? 1 : 0}; }
        ${startPct.toFixed(3)}% { opacity: 1; }
        ${endPct.toFixed(3)}% { opacity: 0; }
        100% { opacity: 0; }
      }
      .score-${i} { animation: score-${i} ${animDuration}s infinite step-end; }
      `;
      scoreElements += `    <text x="${SVG_W - 20}" y="30" font-family="monospace" font-size="16" class="score-text score-${i}" text-anchor="end" font-weight="bold">Score: ${i}</text>\n`;
    }
  }

  let activeGridSVG = `<g class="breakable-grid">\n`;
  masterBrickList.forEach(b => {
    activeGridSVG += `    <rect x="${b.x}" y="${b.y}" width="${CELL}" height="${CELL}" class="lv${b.level} hit-${b.id}" />\n`;
  });
  activeGridSVG += `  </g>\n`;

  // --- Build the <style> block according to theme ---
  let styleBlock = '';
  if (theme === 'auto') {
    // Build CSS with both light and dark using media queries
    const light = THEMES.light;
    const dark = THEMES.dark;
    const lc = light.colors, dc = dark.colors;

    // Common keyframes are already defined, we just need class definitions
    styleBlock = `
      .bg { fill: ${light.bg}; }
      .lv0 { fill: ${lc[0]}; }
      .lv1 { fill: ${lc[1]}; }
      .lv2 { fill: ${lc[2]}; }
      .lv3 { fill: ${lc[3]}; }
      .lv4 { fill: ${lc[4]}; }
      .paddle { fill: ${light.paddle}; }
      .ball { fill: ${light.ball}; }
      .score-text { fill: ${light.text}; }

      @media (prefers-color-scheme: dark) {
        .bg { fill: ${dark.bg}; }
        .lv0 { fill: ${dc[0]}; }
        .lv1 { fill: ${dc[1]}; }
        .lv2 { fill: ${dc[2]}; }
        .lv3 { fill: ${dc[3]}; }
        .lv4 { fill: ${dc[4]}; }
        .paddle { fill: ${dark.paddle}; }
        .ball { fill: ${dark.ball}; }
        .score-text { fill: ${dark.text}; }
      }
    `;
  } else {
    // Single theme
    const t = THEMES[theme] || THEMES.light;
    const c = t.colors;
    styleBlock = `
      .bg { fill: ${t.bg}; }
      .lv0 { fill: ${c[0]}; }
      .lv1 { fill: ${c[1]}; }
      .lv2 { fill: ${c[2]}; }
      .lv3 { fill: ${c[3]}; }
      .lv4 { fill: ${c[4]}; }
      .paddle { fill: ${t.paddle}; }
      .ball { fill: ${t.ball}; }
      .score-text { fill: ${t.text}; }
    `;
  }

  // Combine all styles into one block
  const fullStyle = `
    <style>
      ${styleBlock}
      .ball { filter: drop-shadow(0px 2px 4px rgba(9,105,218,0.4)); }
      @keyframes truePhysicsBall { ${ballKeyframes} }
      .ball-loop { animation: truePhysicsBall ${animDuration}s infinite linear; }
      @keyframes reactivePaddle { ${paddleKeyframes} }
      .paddle-loop { animation: reactivePaddle ${animDuration}s infinite linear; }
${breakKeyframes}
${scoreKeyframes}
    </style>
  `;

  const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SVG_W} ${SVG_H}" width="100%" height="100%">
  <defs>
    ${fullStyle}
  </defs>
  <rect width="${SVG_W}" height="${SVG_H}" class="bg" rx="6" stroke="#d0d7de" stroke-width="2"/>
${staticGridSVG}
${activeGridSVG}
${scoreElements}
  <rect x="0" y="${PADDLE_Y + 6}" width="${PADDLE_WIDTH}" height="10" rx="5" class="paddle paddle-loop" />
  <circle cx="0" cy="0" r="6" class="ball ball-loop" />
</svg>`;

  return { svgContent, animDuration, volleyCounter, totalBricks: masterBrickList.length };
}

// --- 5. EXECUTION ---
(async () => {
  try {
    const fileName = theme === 'dark' ? 'gitball-dark.svg' : 'gitball.svg';
    const weeks = await fetchContributions(GITHUB_USERNAME);
    const { svgContent, animDuration, volleyCounter, totalBricks } = generateDXBallSVG(weeks, BALL_SPEED, theme, showScore);

    fs.writeFileSync(fileName, svgContent.trim());
    const fileSizeInKB = (fs.statSync(fileName).size / 1024).toFixed(2);

    console.log(`
==================================================
🏓 GitBall SVG Generated Successfully!
==================================================
📁 File Name:          ${fileName}
💾 File Size:          ${fileSizeInKB} KB
⏱️ Animation Duration: ${animDuration.toFixed(2)}s
🏓 Total Volleys:       ${volleyCounter}
🧱 Total Bricks Hit:   ${totalBricks}
🎯 Max Miss Threshold:  ${MAX_MISS}
🎨 Theme:              ${theme}
==================================================
`);
  } catch (error) { console.error('❌ Error:', error); }
})();