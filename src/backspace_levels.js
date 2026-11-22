// Backspace levels. Legend:
//  # wall   . empty   P spawn   G goal
//  S switch (hold)    D door (open while any switch is held)
(function(global){
  global.BACKSPACE_LEVELS = [
    {
      name: 'First Echo',
      hint: 'Stand on the switch, then rewind to leave a ghost holding it.',
      echoes: 1,
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
      hint: 'The switch is up high. Hold it, rewind, then race the ghost.',
      echoes: 1,
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
      hint: 'The ghost only lasts two seconds. Find the fastest route.',
      echoes: 1,
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
