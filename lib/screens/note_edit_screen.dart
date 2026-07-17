import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:note_app/providers/note_provider.dart';
import 'package:note_app/models/note.dart';
import 'package:uuid/uuid.dart';

class NoteEditScreen extends StatefulWidget {
  const NoteEditScreen({super.key});

  @override
  State<NoteEditScreen> createState() => _NoteEditScreenState();
}

class _NoteEditScreenState extends State<NoteEditScreen> {
  final _formKey = GlobalKey<FormState>();
  late String _title;
  late String _content;
  late Color _color;
  late Note _note;
  bool _isNewNote = true;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final noteId = ModalRoute.of(context)!.settings.arguments as String?;
    if (noteId != null) {
      _isNewNote = false;
      final noteProvider = Provider.of<NoteProvider>(context, listen: false);
      _note = noteProvider.notes.firstWhere((note) => note.id == noteId);
      _title = _note.title;
      _content = _note.content;
      _color = _note.color;
    } else {
      _title = '';
      _content = '';
      _color = Colors.white;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(_isNewNote ? 'New Note' : 'Edit Note'),
        actions: [
          IconButton(
            icon: const Icon(Icons.save),
            onPressed: _saveNote,
          ),
        ],
      ),
      body: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Form(
          key: _formKey,
          child: Column(
            children: [
              TextFormField(
                initialValue: _title,
                decoration: const InputDecoration(
                  labelText: 'Title',
                  border: OutlineInputBorder(),
                ),
                validator: (value) {
                  if (value == null || value.isEmpty) {
                    return 'Please enter a title';
                  }
                  return null;
                },
                onSaved: (value) => _title = value!,
              ),
              const SizedBox(height: 16.0),
              TextFormField(
                initialValue: _content,
                decoration: const InputDecoration(
                  labelText: 'Content',
                  border: OutlineInputBorder(),
                ),
                maxLines: 10,
                validator: (value) {
                  if (value == null || value.isEmpty) {
                    return 'Please enter content';
                  }
                  return null;
                },
                onSaved: (value) => _content = value!,
              ),
              const SizedBox(height: 16.0),
              Row(
                children: [
                  const Text('Color:'),
                  const SizedBox(width: 16.0),
                  _buildColorOption(Colors.white),
                  _buildColorOption(Colors.yellow),
                  _buildColorOption(Colors.green),
                  _buildColorOption(Colors.blue),
                  _buildColorOption(Colors.purple),
                  _buildColorOption(Colors.red),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildColorOption(Color color) {
    return GestureDetector(
      onTap: () {
        setState(() {
          _color = color;
        });
      },
      child: Container(
        width: 30.0,
        height: 30.0,
        margin: const EdgeInsets.symmetric(horizontal: 4.0),
        decoration: BoxDecoration(
          color: color,
          shape: BoxShape.circle,
          border: _color == color
              ? Border.all(color: Colors.black, width: 2.0)
              : null,
        ),
      ),
    );
  }

  void _saveNote() {
    if (_formKey.currentState!.validate()) {
      _formKey.currentState!.save();

      final noteProvider = Provider.of<NoteProvider>(context, listen: false);
      final now = DateTime.now();

      if (_isNewNote) {
        final newNote = Note(
          id: const Uuid().v4(),
          title: _title,
          content: _content,
          color: _color,
          createdAt: now,
          updatedAt: now,
        );
        noteProvider.addNote(newNote);
      } else {
        _note.title = _title;
        _note.content = _content;
        _note.color = _color;
        _note.updatedAt = now;
        noteProvider.updateNote(_note);
      }

      Navigator.pop(context);
    }
  }
}
