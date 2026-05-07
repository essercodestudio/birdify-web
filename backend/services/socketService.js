let _io = null;

exports.setIo = (io) => { _io = io; };

exports.emitToRoom = (room, event, data) => {
  if (_io) _io.to(room).emit(event, data);
};

exports.emitToAll = (event, data) => {
  if (_io) _io.emit(event, data);
};
