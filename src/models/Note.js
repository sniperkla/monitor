import mongoose from 'mongoose';

const NoteSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  content: { type: String, default: '' },
}, {
  timestamps: true,
});

export function getNoteModel(dbConnection) {
  const target = dbConnection || mongoose;
  return target.models.Note || target.model('Note', NoteSchema);
}

export default mongoose.models.Note || mongoose.model('Note', NoteSchema);
export { NoteSchema };
