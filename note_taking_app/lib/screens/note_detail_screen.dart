import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import '../bloc/note_bloc.dart';
import '../models/note.dart';

class NoteDetailScreen extends StatefulWidget {
  final Note note;

  const NoteDetailScreen({Key? key, required this.note}) : super(key: key);

  @override
  _NoteDetailScreenState createState() => _NoteDetailScreenState();
}

class _NoteDetailScreenState extends State<NoteDetailScreen> {
  late TextEditingController _titleController;
  late TextEditingController _contentController;

  @override
  void initState() {
    super.initState();
    _titleController = TextEditingController(text: widget.note.title);
    _contentController = TextEditingController(text: widget.note.content);
  }

  @override
  void dispose() {
    _titleController.dispose();
    _contentController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text('Note Details'),
        actions: [
          IconButton(
            icon: Icon(Icons.save),
            onPressed: () {
              final updatedNote = Note(
                id: widget.note.id,
                title: _titleController.text,
                content: _contentController.text,
                createdAt: widget.note.createdAt,
                updatedAt: DateTime.now(),
              );
              BlocProvider.of<NoteBloc>(context).add(UpdateNote(updatedNote));
              Navigator.pop(context);
            },
          ),
          IconButton(
            icon: Icon(Icons.delete),
            onPressed: () {
              BlocProvider.of<NoteBloc>(context).add(DeleteNote(widget.note.id));
              Navigator.pop(context);
            },
          ),
        ],
      ),
      body: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          children: [
            TextField(
              controller: _titleController,
              decoration: InputDecoration(
                labelText: 'Title',
              ),
            ),
            TextField(
              controller: _contentController,
              decoration: InputDecoration(
                labelText: 'Content',
              ),
              maxLines: null,
            ),
          ],
        ),
      ),
    );
  }
}
