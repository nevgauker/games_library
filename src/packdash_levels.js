// Pack & Dash! levels. Legend (see src/packdash.js for the rules):
//  # wall/desk   . floor   P player spawn   b boss start (patrols horizontally)
//  E elevator (2x2 block)   1-9 desk items (index into PACKDASH_ITEMS, 1-based)
//
// Every level is verified by `npm run check-packdash`: the map is well formed,
// every item and the elevator are reachable, the boss can't spot you at spawn,
// and a bot following the shortest route wins against the real engine.
(function(global){
  global.PACKDASH_ITEMS = [
    { icon:'☕', name:'coffee mug', memory:'“Remember the latte art phase? Abstract, but heartfelt.”' },
    { icon:'🌱', name:'desk plant', memory:'“Remember naming the plant Carl? A true survivor.”' },
    { icon:'🧼', name:'weird stress ball', memory:'“Remember squishing this during all‑hands? Elite form.”' },
    { icon:'🖊️', name:'favorite pen', memory:'“Remember guarding this pen like treasure? Valid.”' },
    { icon:'📎', name:'lucky paperclip', memory:'“Remember the paperclip chain championship? Unstoppable.”' },
    { icon:'🍪', name:'secret snack', memory:'“Remember snack o’clock at 3:07? Iconic.”' },
  ];

  global.PACKDASH_LEVELS = [
    {
      name: 'Open Plan',
      time: 60,
      boss: { speed: 40, range: 6 },
      map: [
        '########################',
        '#......................#',
        '#.P.........b..........#',
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
