package com.markspace.tasks.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.markspace.sync.ConflictChoice
import com.markspace.sync.SyncStatus
import com.markspace.tasks.R
import com.markspace.tasks.data.SyncPrefs
import com.markspace.tasks.ui.components.SoftChip
import com.markspace.tasks.ui.theme.MsColors
import com.markspace.tasks.ui.theme.MsTypography

@Composable
fun SyncSettingsScreen(
    prefs: SyncPrefs,
    status: SyncStatus,
    busy: Boolean,
    message: String?,
    error: String?,
    onboarding: Boolean,
    onSave: (remote: String, token: String, autoMinutes: Int) -> Unit,
    onClone: () -> Unit,
    onLocalVault: () -> Unit,
    onSyncNow: () -> Unit,
    onResolve: (path: String, choice: ConflictChoice) -> Unit,
    onBack: (() -> Unit)? = null,
) {
    var remote by remember(prefs.remoteUrl) { mutableStateOf(prefs.remoteUrl) }
    var token by remember(prefs.token) { mutableStateOf(prefs.token) }
    var auto by remember(prefs.autoSyncMinutes) { mutableIntStateOf(prefs.autoSyncMinutes) }
    val autoOptions = listOf(0 to "Off", 5 to "5 min", 15 to "15 min", 30 to "30 min", 60 to "60 min")

    val colors = OutlinedTextFieldDefaults.colors(
        focusedBorderColor = MsColors.Accent,
        cursorColor = MsColors.Accent,
        focusedLabelColor = MsColors.AccentStrong,
    )

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MsColors.Bg)
            .verticalScroll(rememberScrollState())
            .padding(20.dp),
    ) {
        if (onboarding) {
            BrandMark(large = true)
            Spacer(Modifier.height(16.dp))
            Text(
                stringResource(R.string.onboarding_title),
                style = MsTypography.headlineMedium,
            )
            Spacer(Modifier.height(8.dp))
            Text(
                stringResource(R.string.brand_tagline),
                style = MsTypography.bodyMedium.copy(color = MsColors.AccentStrong),
            )
            Spacer(Modifier.height(8.dp))
            Text(
                stringResource(R.string.onboarding_subtitle),
                style = MsTypography.bodyMedium,
            )
        } else {
            Text(
                stringResource(R.string.sync_title),
                style = MsTypography.headlineMedium,
            )
            Spacer(Modifier.height(8.dp))
            Text(
                stringResource(R.string.onboarding_subtitle),
                style = MsTypography.bodyMedium,
            )
        }
        Spacer(Modifier.height(20.dp))

        OutlinedTextField(
            value = remote,
            onValueChange = { remote = it },
            modifier = Modifier.fillMaxWidth(),
            label = { Text("Repository (owner/repo or HTTPS)") },
            singleLine = true,
            colors = colors,
        )
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(
            value = token,
            onValueChange = { token = it },
            modifier = Modifier.fillMaxWidth(),
            label = { Text("GitHub PAT (repo scope)") },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            colors = colors,
        )
        Spacer(Modifier.height(12.dp))
        Text("Auto-sync", style = MsTypography.labelLarge)
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            autoOptions.forEach { (mins, label) ->
                SoftChip(
                    label = label,
                    tint = if (auto == mins) MsColors.Accent else null,
                    bg = if (auto == mins) MsColors.Accent.copy(alpha = 0.12f) else null,
                    onClick = { auto = mins },
                )
            }
        }

        Spacer(Modifier.height(16.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(
                onClick = {
                    onSave(remote, token, auto)
                    onClone()
                },
                enabled = !busy,
                colors = ButtonDefaults.buttonColors(containerColor = MsColors.Accent),
            ) {
                Text(if (prefs.cloned) "Reconnect" else "Clone")
            }
            if (prefs.cloned) {
                Button(
                    onClick = {
                        onSave(remote, token, auto)
                        onSyncNow()
                    },
                    enabled = !busy,
                    colors = ButtonDefaults.buttonColors(containerColor = MsColors.AccentStrong),
                ) {
                    Text("Sync Now")
                }
            }
            if (onBack != null) {
                TextButton(onClick = onBack) { Text("Back") }
            }
        }
        if (onboarding) {
            Spacer(Modifier.height(8.dp))
            TextButton(
                onClick = onLocalVault,
                enabled = !busy,
            ) {
                Text("Continue offline (local vault)")
            }
        }

        if (busy) {
            Spacer(Modifier.height(16.dp))
            CircularProgressIndicator(color = MsColors.Accent)
        }

        Spacer(Modifier.height(16.dp))
        val statusLine = buildString {
            if (status.connected) {
                append(status.remoteUrl ?: "")
                status.branch?.let { append(" · ").append(it) }
                if (status.dirty) append(" · dirty")
                if (status.ahead > 0) append(" · ↑${status.ahead}")
                if (status.behind > 0) append(" · ↓${status.behind}")
            } else {
                append("Not connected")
            }
        }
        Text(statusLine, style = MsTypography.bodyMedium)
        prefs.lastSyncAt?.let {
            Text("Last sync: $it", style = MsTypography.labelSmall)
        }
        message?.let {
            Spacer(Modifier.height(8.dp))
            Text(it, style = MsTypography.bodyMedium.copy(color = MsColors.AccentStrong))
        }
        error?.let {
            Spacer(Modifier.height(8.dp))
            Text(it, style = MsTypography.bodyMedium.copy(color = MsColors.Danger))
        }

        if (status.conflictPaths.isNotEmpty()) {
            Spacer(Modifier.height(20.dp))
            Text("Conflicts", style = MsTypography.titleMedium)
            status.conflictPaths.forEach { path ->
                Spacer(Modifier.height(8.dp))
                Text(path, style = MsTypography.bodyMedium)
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    TextButton(onClick = { onResolve(path, ConflictChoice.Ours) }) {
                        Text("Keep mine")
                    }
                    TextButton(onClick = { onResolve(path, ConflictChoice.Theirs) }) {
                        Text("Keep theirs")
                    }
                    if (path.endsWith(".md", ignoreCase = true)) {
                        TextButton(onClick = { onResolve(path, ConflictChoice.Both) }) {
                            Text("Keep both")
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun BrandMark(large: Boolean = false) {
    val size = if (large) 64.dp else 36.dp
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(
            modifier = Modifier
                .size(size)
                .clip(CircleShape)
                .background(MsColors.Accent)
                .border(0.dp, Color.Transparent, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                Icons.Default.Check,
                contentDescription = null,
                tint = Color.White,
                modifier = Modifier.size(if (large) 32.dp else 20.dp),
            )
        }
        if (!large) {
            Spacer(Modifier.width(10.dp))
            Text(
                stringResource(R.string.app_name),
                style = MsTypography.titleMedium.copy(color = MsColors.AccentStrong),
            )
        }
    }
}
