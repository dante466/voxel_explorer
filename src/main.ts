import './style.css'
import Stats from 'stats.js';

// Create a canvas element
const canvas = document.createElement('canvas');
canvas.id = 'gameCanvas';
document.body.appendChild(canvas);

// Check for debug mode
const urlParams = new URLSearchParams(window.location.search);
const debugMode = urlParams.has('debug');

if (debugMode) {
  const stats = new Stats();
  stats.showPanel(0); // 0: fps, 1: ms, 2: mb, 3+: custom
  document.body.appendChild(stats.dom);

  const animate = () => {
    stats.begin();

    // main render loop here
    // for now, it's empty as we only have a blank canvas

    stats.end();
    requestAnimationFrame(animate);
  };
  requestAnimationFrame(animate);
}

// Basic setup to make canvas visible if needed (optional, CSS handles this better)
// canvas.width = window.innerWidth;
// canvas.height = window.innerHeight;
// const context = canvas.getContext('2d');
// if (context) {
//   context.fillStyle = 'black'; // Or any other color to ensure it's not transparent
//   context.fillRect(0, 0, canvas.width, canvas.height);
// }
