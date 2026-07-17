part of 'note_bloc.dart';

abstract class NoteState {}

class NoteInitial extends NoteState {}

class NotesLoaded extends NoteState {
  final List<Note> notes;

  NotesLoaded({required this.notes});
}
