import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:hive/hive.dart';
import 'package:note_app/models/note.dart';

part 'note_event.dart';
part 'note_state.dart';

class NoteBloc extends Bloc<NoteEvent, NoteState> {
  final Box<Note> noteBox = Hive.box<Note>('notes');

  NoteBloc() : super(NoteInitial()) {
    on<LoadNotes>(_onLoadNotes);
    on<AddNote>(_onAddNote);
    on<UpdateNote>(_onUpdateNote);
    on<DeleteNote>(_onDeleteNote);
  }

  void _onLoadNotes(LoadNotes event, Emitter<NoteState> emit) {
    final notes = noteBox.values.toList();
    emit(NotesLoaded(notes: notes));
  }

  void _onAddNote(AddNote event, Emitter<NoteState> emit) {
    noteBox.add(event.note);
    final notes = noteBox.values.toList();
    emit(NotesLoaded(notes: notes));
  }

  void _onUpdateNote(UpdateNote event, Emitter<NoteState> emit) {
    event.note.save();
    final notes = noteBox.values.toList();
    emit(NotesLoaded(notes: notes));
  }

  void _onDeleteNote(DeleteNote event, Emitter<NoteState> emit) {
    event.note.delete();
    final notes = noteBox.values.toList();
    emit(NotesLoaded(notes: notes));
  }
}