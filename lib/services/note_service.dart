import 'package:shared_preferences/shared_preferences.dart';
import '../models/note.dart';

class NoteService {
  static const String _key = 'notes';

  Future<List<Note>> getNotes() async {
    final prefs = await SharedPreferences.getInstance();
    final notesJson = prefs.getStringList(_key) ?? [];
    return notesJson.map((noteJson) => Note.fromMap(Map<String, dynamic>.from({
      'id': noteJson.split('|')[0],
      'title': noteJson.split('|')[1],
      'content': noteJson.split('|')[2],
    }))).toList();
  }

  Future<void> saveNotes(List<Note> notes) async {
    final prefs = await SharedPreferences.getInstance();
    final notesJson = notes.map((note) => '${note.id}|${note.title}|${note.content}').toList();
    await prefs.setStringList(_key, notesJson);
  }
}
