// Backspace levels. Legend:
//  # wall   . empty   P spawn   G goal
//  S plate (hold)     D door (open while any plate is held)
(function(global){
  global.BACKSPACE_LEVELS = [
    {
      name: 'First Echo',
      hint: 'Stand on the plate, then hold Backspace to rewind. Your echo will keep holding it.',
      tips: [ { at:[8,5], text:'Stand here' }, { at:[3,4], text:'Hold Backspace to rewind' } ],
      echoes: 1,
      par: { echoes: 1, time: 10 },
      map: [
        "########################",
        "#..........#...........#",
        "#..........#...........#",
        "#..........#...........#",
        "#..........#...........#",
        "#..........#...........#",
        "#..........#...........#",
        "#.P.....S..D........G..#",
        "########################",
      ],
      solution: [ {to:[8,7]}, {wait:130}, {rewind:120}, {to:[20,7]} ],
    },
    {
      name: 'Ledge',
      hint: 'The plate is up high. Hold it, rewind, then race to the door while your echo holds it.',
      echoes: 1,
      par: { echoes: 1, time: 10 },
      map: [
        "########################",
        "#..........#...........#",
        "#..........#...........#",
        "#..........#...........#",
        "#..........#...........#",
        "#....S.....#...........#",
        "#...###....#...........#",
        "#P.#.......D........G..#",
        "########################",
      ],
      solution: [ {to:[5,5]}, {wait:130}, {rewind:120}, {to:[20,7]} ],
    },
    {
      name: 'Long Way Down',
      hint: 'Echoes only last as long as you rewind. Find a fast route to the door.',
      echoes: 1,
      par: { echoes: 1, time: 10 },
      map: [
        "########################",
        "#.........#............#",
        "#.........#............#",
        "#.........#....S.......#",
        "#.........#...####.....#",
        "#.........#............#",
        "#.........#.......##...#",
        "#..G......D..........P.#",
        "########################",
      ],
      solution: [ {to:[15,3]}, {wait:130}, {rewind:120}, {to:[3,7]} ],
    },
  ];
})(typeof window !== 'undefined' ? window : globalThis);
