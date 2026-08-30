package com.markspace.tasks.ui.screens

import android.graphics.BitmapFactory
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.AddPhotoAlternate
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.markspace.tasknotes.TaskNote
import com.markspace.tasks.ui.components.LabelChip
import com.markspace.tasks.ui.components.PriorityChip
import com.markspace.tasks.ui.components.SoftChip
import com.markspace.tasks.ui.components.TaskCircle
import com.markspace.tasks.ui.theme.MsColors
import com.markspace.tasks.ui.theme.MsTypography
import com.markspace.tasks.ui.theme.PriorityNone
import com.markspace.tasks.ui.theme.PriorityOptions
import java.io.File

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TaskDetailScreen(
    note: TaskNote,
    vaultRoot: File,
    onBack: () -> Unit,
    onToggle: () -> Unit,
    onSave: (
        title: String,
        due: String?,
        clearDue: Boolean,
        priority: Int?,
        clearPriority: Boolean,
        labels: List<String>,
        status: String,
    ) -> Unit,
    onComment: (String) -> Unit,
    onImage: (fileName: String, bytes: ByteArray) -> Unit,
    onCreateChild: (String) -> Unit,
    onPromote: () -> Unit,
) {
    var title by remember(note.path, note.title) { mutableStateOf(note.title) }
    var due by remember(note.path, note.attrs.due) { mutableStateOf(note.attrs.due ?: "") }
    var priority by remember(note.path, note.attrs.priority) { mutableStateOf(note.attrs.priority) }
    var labelsText by remember(note.path) {
        mutableStateOf(note.attrs.labels.joinToString(", "))
    }
    var comment by remember { mutableStateOf("") }
    var childTitle by remember { mutableStateOf("") }
    var priorityMenu by remember { mutableStateOf(false) }
    val context = LocalContext.current

    val gallery = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri: Uri? ->
        if (uri == null) return@rememberLauncherForActivityResult
        val name = uri.lastPathSegment?.substringAfterLast('/') ?: "image.jpg"
        val bytes = context.contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: return@rememberLauncherForActivityResult
        onImage(name, bytes)
    }

    val colors = OutlinedTextFieldDefaults.colors(
        focusedBorderColor = MsColors.Accent,
        cursorColor = MsColors.Accent,
    )

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MsColors.Surface),
    ) {
        TopAppBar(
            title = { Text("Task", style = MsTypography.titleMedium) },
            navigationIcon = {
                IconButton(onClick = onBack) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                }
            },
            actions = {
                IconButton(onClick = { gallery.launch("image/*") }) {
                    Icon(Icons.Default.AddPhotoAlternate, contentDescription = "Add photo")
                }
            },
            colors = TopAppBarDefaults.topAppBarColors(containerColor = MsColors.Surface),
        )

        Column(
            modifier = Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp, vertical = 8.dp),
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                TaskCircle(
                    checked = note.attrs.status == "done",
                    priority = priority,
                    onClick = onToggle,
                )
                OutlinedTextField(
                    value = title,
                    onValueChange = { title = it },
                    modifier = Modifier.weight(1f),
                    textStyle = MsTypography.headlineMedium,
                    colors = colors,
                )
            }
            Spacer(Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SoftChip(
                    label = if (due.isBlank()) "Due" else due,
                    onClick = {},
                )
                SoftChip(
                    label = (PriorityOptions + PriorityNone).first { it.value == priority }.label,
                    tint = (PriorityOptions + PriorityNone).first { it.value == priority }.color,
                    bg = (PriorityOptions + PriorityNone).first { it.value == priority }.chipBg,
                    onClick = { priorityMenu = true },
                )
                DropdownMenu(expanded = priorityMenu, onDismissRequest = { priorityMenu = false }) {
                    (listOf(PriorityNone) + PriorityOptions).forEach { opt ->
                        DropdownMenuItem(
                            text = { Text(opt.label, color = opt.color) },
                            onClick = {
                                priority = opt.value
                                priorityMenu = false
                            },
                        )
                    }
                }
            }
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(
                value = due,
                onValueChange = { due = it },
                modifier = Modifier.fillMaxWidth(),
                label = { Text("Due (YYYY-MM-DD)") },
                singleLine = true,
                colors = colors,
            )
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(
                value = labelsText,
                onValueChange = { labelsText = it },
                modifier = Modifier.fillMaxWidth(),
                label = { Text("Labels") },
                singleLine = true,
                colors = colors,
            )
            if (note.attrs.labels.isNotEmpty()) {
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    note.attrs.labels.forEach { LabelChip(it) }
                    PriorityChip(note.attrs.priority)
                }
            }

            Spacer(Modifier.height(16.dp))
            Button(
                onClick = {
                    val labels = labelsText.split(",")
                        .map { it.trim().trimStart('#') }
                        .filter { it.isNotEmpty() }
                    onSave(
                        title.trim().ifEmpty { "Untitled" },
                        due.trim().ifEmpty { null },
                        due.isBlank(),
                        priority,
                        priority == null,
                        labels,
                        note.attrs.status,
                    )
                },
                colors = ButtonDefaults.buttonColors(containerColor = MsColors.Accent),
            ) {
                Text("Save")
            }

            if (note.attrs.parent != null) {
                TextButton(onClick = onPromote) { Text("Promote to root") }
            }

            Spacer(Modifier.height(20.dp))
            Text("Subtasks", style = MsTypography.titleMedium)
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = childTitle,
                    onValueChange = { childTitle = it },
                    modifier = Modifier.weight(1f),
                    placeholder = { Text("Add child task") },
                    singleLine = true,
                    colors = colors,
                )
                Button(
                    onClick = {
                        if (childTitle.isNotBlank()) {
                            onCreateChild(childTitle.trim())
                            childTitle = ""
                        }
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = MsColors.Accent),
                ) {
                    Text("Add")
                }
            }

            Spacer(Modifier.height(20.dp))
            Text("Comments", style = MsTypography.titleMedium)
            note.comments.forEach { c ->
                Spacer(Modifier.height(12.dp))
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .border(1.dp, MsColors.Divider, RoundedCornerShape(8.dp))
                        .padding(12.dp),
                ) {
                    Text(c.at, style = MsTypography.labelSmall)
                    Spacer(Modifier.height(4.dp))
                    Text(c.body, style = MsTypography.bodyLarge)
                    val assetMatch = Regex("""!\[[^\]]*]\((\.assets/[^)]+)\)""").find(c.body)
                    if (assetMatch != null) {
                        val rel = assetMatch.groupValues[1]
                        val assetFile = File(File(vaultRoot, note.path).parentFile, rel)
                        if (assetFile.exists()) {
                            Spacer(Modifier.height(8.dp))
                            AsyncImage(
                                model = assetFile,
                                contentDescription = null,
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(180.dp),
                            )
                        }
                    }
                }
            }
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(
                value = comment,
                onValueChange = { comment = it },
                modifier = Modifier.fillMaxWidth(),
                label = { Text("Add comment") },
                minLines = 2,
                colors = colors,
            )
            Spacer(Modifier.height(8.dp))
            Button(
                onClick = {
                    if (comment.isNotBlank()) {
                        onComment(comment.trim())
                        comment = ""
                    }
                },
                colors = ButtonDefaults.buttonColors(containerColor = MsColors.Accent),
            ) {
                Text("Post comment")
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}
