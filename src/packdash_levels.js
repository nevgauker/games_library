// Pack & Dash! levels. Map legend (see src/packdash.js for the rules):
//  # wall/desk   . floor   P player spawn   E elevator (2x2 block)
//  1-9  desk items: digit n is level.items[n-1], an id in PACKDASH_ITEMS
//
// Level fields: name, hint, time (limit, s), par (3-star time, s), silver (2-star, default par*1.3),
//  bosses / coworkers: [{ path:[[x,y],...] straight segments, speed px/s, pause s at ends,
//                         loop (walk path as a circuit), delay s before starting,
//                         range (boss cone length in tiles), line (coworker small talk) }]
//
// Every level is verified by `npm run check-packdash`: the map is well formed,
// every item and the elevator are reachable, nobody sees you at the spawn, and a
// stealth bot beats the par time on the real engine.
(function(global){
  global.PACKDASH_ITEMS = {
    mug:      { icon:'☕', name:'coffee mug',        weight:1, memory:'“Remember the latte art phase? Abstract, but heartfelt.”' },
    plant:    { icon:'🌱', name:'desk plant',        weight:2, memory:'“Remember naming the plant Carl? A true survivor.”' },
    ball:     { icon:'🧼', name:'weird stress ball', weight:1, memory:'“Remember squishing this during all‑hands? Elite form.”' },
    pen:      { icon:'🖊️', name:'favorite pen',      weight:1, memory:'“Remember guarding this pen like treasure? Valid.”' },
    clip:     { icon:'📎', name:'lucky paperclip',   weight:1, memory:'“Remember the paperclip chain championship? Unstoppable.”' },
    snack:    { icon:'🍪', name:'secret snack',      weight:1, memory:'“Remember snack o’clock at 3:07? Iconic.”' },
  };

  global.PACKDASH_LEVELS = [
    {
      name: 'Open Plan',
      hint: 'Stand on your stuff to pack it, then hit the elevator. Stay out of the boss’s gaze!',
      time: 45, par: 20,
      items: ['mug', 'plant', 'ball', 'pen', 'clip', 'snack'],
      bosses: [ { path: [[11,2],[11,9],[20,9]], speed: 36, pause: 1.0, range: 5 } ],
      coworkers: [ { path: [[2,13],[12,13]], speed: 28, line: '“Big plans for the weekend?” You now have big plans.' } ],
      map: [
        '########################',
        '#......................#',
        '#.P....................#',
        '#......................#',
        '#...1.....2.......3....#',
        '#.....####....####.....#',
        '#.....####....####.....#',
        '#......................#',
        '#......................#',
        '#...4.............5....#',
        '#......................#',
        '#.....####....####.....#',
        '#.....####....####.....#',
        '#......................#',
        '#......................#',
        '#.......6..............#',
        '#......................#',
        '#....................EE#',
        '#....................EE#',
        '########################',
      ],
    },
  ];
})(window);
