import mongoose from 'mongoose';

const NoteSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  content: { type: String, default: '' },
}, {
  timestamps: true,
});

export function getNoteModel(dbConnection) {
  // If we have a valid Mongoose connection (either an actual Connection object or the default mongoose instance), use its models.
  // We check for .type (our SQL driver marker) or missing .model to detect non-Mongoose objects.
  const target = (dbConnection && !dbConnection.type && dbConnection.model) ? dbConnection : mongoose;
  
  return target.models.Note || target.model('Note', NoteSchema);
}

export default mongoose.models.Note || mongoose.model('Note', NoteSchema);
export { NoteSchema };
