import 'package:hive/hive.dart';
import 'package:note_app/models/note.dart';

class LocalStorageService {
  static const String _notesBoxName = 'notes';

  Future<void> init() async {
    await Hive.initFlutter();
    Hive.registerAdapter(NoteAdapter());
    await Hive.openBox<Note>(_notesBoxName);
  }

  Future<List<Note>> getNotes() async {
    final box = Hive.box<Note>(_notesBoxName);
    return box.values.toList();
  }

  Future<void> saveNotes(List<Note> notes) async {
    final box = Hive.box<Note>(_notesBoxName);
    await box.clear();
    await box.addAll(notes);
  }
}

class NoteAdapter extends TypeAdapter<Note> {
  @override
  final int typeId = 0;

  @override
  Note read(BinaryReader reader) {
    return Note(
      id: reader.readString(),
      title: reader.readString(),
      content: reader.readString(),
      color: Color(reader.readInt()),
      createdAt: DateTime.fromMillisecondsSinceEpoch(reader.readInt()),
      updatedAt: DateTime.fromMillisecondsSinceEpoch(reader.readInt()),
    );
  }

  @override
  void write(BinaryWriter writer, Note obj) {
    writer.writeString(obj.id);
    writer.writeString(obj.title);
    writer.writeString(obj.content);
    writer.writeInt(obj.color.value);
    writer.writeInt(obj.createdAt.millisecondsSinceEpoch);
    writer.writeInt(obj.updatedAt.millisecondsSinceEpoch);
  }
}
