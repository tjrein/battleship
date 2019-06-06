/*
---------------------------------------------------------------------------------
  Name: server_helpers.js

  Purpose:
    This file contains helper functions for the Battleship protocol server
    These functions are not directly related to the proctocol, but instead help the server play a simplified game of battleship

  Date: 06/07/2019

  Author: Tom Rein
--------------------------------------------------------------------------------
*/


//This function performs a deep copy on a grid,
//The grid is a 2x2 array of some size, determined in the configuration file.
function clone_grid(grid) {
  return JSON.parse(JSON.stringify(grid))
}


/*
  This function validates if a ship was sunk.
  Ships are represented on the grid by their id.
  For example, a destroyer has an id of 5 and a size of 2, so there would be two 5's on the grid.
  As ships are hit, the numbers are replaced by x's.
  So, once there are no more corresponding id's on the grid, the ship is considered sunk.
*/
function validate_sunk(id, grid) {
  //itereate through each row of the grid, if the id is found, return false, i.e. not sunk.
  for (let i=0; i < grid.length; i++) {
    let row = grid[i];
    if (row.includes(id)) return false;
  }
  //if loop terminates, it means no id was found in any row, i.e. sunk
  return true;
}


/*
  This function validates the Battleship win condition, i.e., all ships are sunk.
  The grid initialized to be all 0's.
  This function iterates through every row of the grid, and checks that every grid location is either a 0 or and x.
  A 0 indicates an empty position, and an 'x' indicates a hit position.
  Therefore, if every location is 0 or an 'x', it means placed ships have been sunk and the game is over.
*/
function validate_win(grid) {
  for (let i = 0; i < grid.length; i++) {
    let row = grid[i];
    let pass = row.every(position => position === 0 || position === 'x');

    //This means at least one element in the row was a ship id, therefore not all ships are sunk.
    if (!pass) return false;
  }

  //if loop terminates, no ship ids were found in any row on the grid, i.e., the game is won.
  return true;
}

function validate_placement(ships, guess_map, ship_name, location, orientation, conn_wrapper) {
  let ship = ships[ship_name];
  let grid = conn_wrapper.grid;

  let positions = [];
  starting_position = guess_map[location];
  positions.push(starting_position);

  if (!ship) {
    console.log("Not a valid ship!");
    return false;
  }

  if (starting_position === undefined) {
    console.log("Invalid starting position!");
    return false;
  }

  if (!['v', 'h'].includes(orientation)) {
    console.log("Not a valid orientation");
    return false;
  }

  for (i=0; i < ship.size - 1; i++) {
    let last_entry = positions[positions.length - 1];
    let new_entry = [];
    if (orientation ===  'h') {
      new_entry = [last_entry[0], last_entry[1] + 1];
    }

    if (orientation === 'v') {
      new_entry = [last_entry[0] + 1, last_entry[1]];
    }

    let [y, x] = new_entry

    if (grid[y][x] === undefined) {
      return false;
    }
    positions.push(new_entry);
  }

  return positions;
}


/*
  This function helps convert positions represented by indices back into human readable grid locations.
  It selects all the keys of guess map, e.g. b3, and selects the key that corresponds to a given array position.
  Because JavaScript treats arrays as separate objects, you cannot compare eqaulity directly.
  To get around this, the arrays are joined as strings so they can be compared. 
*/
function convert_position(guess_map, position) {
  return Object.keys(guess_map).find(key => guess_map[key].join() === position.join());
}

//Export the functions so they can be imported by other files
module.exports.clone_grid = clone_grid;
module.exports.validate_sunk = validate_sunk;
module.exports.validate_win = validate_win;
module.exports.validate_placement = validate_placement;
module.exports.convert_position = convert_position;
