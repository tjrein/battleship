let command = "PLACE";
let params = ['destroyer', 'b2', 'v'];

let [ship_name, location, orientation] = params;


const ships =  {
  'destroyer': {size: 2, id: 5}
}


const grid = [
               [0, 0, 0, 0],
               [0, 0, 0, 5],
               [0, 0, 0, 5],
               [0, 0, 0, 0]
             ]

conn_wrapper = { grid: [...grid] }

const letters = ['a', 'b', 'c'];
const numbers = ['1', '2', '3'];


const guess_map = {
  'a1': [0, 0],
  'b1': [0, 1],
  'c1': [0, 2],
  'd1': [0, 3],
  'a2': [1, 0],
  'b2': [1, 1],
  'c2': [1, 2],
  'd2': [1, 3],
  'a3': [2, 0],
  'b3': [2, 1],
  'c3': [2, 2],
  'd4': [2, 3]
}

let ship = ships[ship_name];

let positions = [];
let [letter, number] = location.split("");

starting_position = guess_map[location];
positions.push(starting_position);

for (i=0; i < ship.size - 1; i++) {
  let last_entry = positions[positions.length - 1];
  let new_entry = [];
  if (orientation ===  'h') {
     new_entry = [last_entry[0], last_entry[1] + 1];
  }

  if (orientation === 'v') {
     new_entry = [last_entry[0] + 1, last_entry[1]];
  }
  positions.push(new_entry);
}

for (row of grid) {
  let ind = row.indexOf(ship.id);
  if (ind > -1) {
    row[ind] = 0;
  }
}

for (position of positions) {
  grid[position[0]][position[1]] = ship.id;
}

console.log("grid", grid)
