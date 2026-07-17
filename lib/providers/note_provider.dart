import 'package:flutter/material.dart';
import '../models/note.dart';
import '../services/note_service.dart';

class NoteProvider with ChangeNotifier {
  final NoteService _noteService = NoteService();
  List<Note> _notes = [];

  List<Note> get notes => _notes;

  Future<void> loadNotes() async {
    _notes = await _noteService.getNotes();
    notifyListeners();
  }

  Future<void> addNote(Note note) async {
    _notes.add(note);
    await _noteService.saveNotes(_notes);
    notifyListeners();
  }

  Future<void> updateNote(Note note) async {
    final index = _notes.indexWhere((n) => n.id == note.id);
    if (index != -1) {
      _notes[index] = note;
      await _noteService.saveNotes(_notes);
      notifyListeners();
    }
  }

  Future<void> deleteNote(String id) async {
    _notes.removeWhere((note) => note.id == id);
    await _noteService.saveNotes(_notes);
    notifyListeners();
  }
}
