<template>
  <div class="abele-settings__ai">
    <Setting
      v-if="page === 'general'"
      :name="t('settings.ai.GeneralSettings.ai_agent.b48c8be3')"
      :desc="t('settings.ai.GeneralSettings.enable_ai_agent_features_including.f1bb9425')"
    >
      <Checkbox :is-enabled="enabled" @toggle="toggleEnabled" />
    </Setting>

    <!-- The agent's own settings over three tabs: General for what it is and where its things
         live, Models for what it talks to, Prompts for the words it uses — the rare part. -->
    <EmptyState
      v-if="!enabled && page !== 'general'"
      :text="t('settings.ai.GeneralSettings.the_ai_agent_is_off.e967af23')"
    />
    <template v-if="enabled && page === 'general'">
      <template v-if="Platform.isMobile">
        <Setting
          :name="t('settings.ai.GeneralSettings.keep_running_in_background_while.32440789')"
          :desc="t('settings.ai.GeneralSettings.play_silent_audio_while_a.325ce1f2')"
        >
          <Checkbox :is-enabled="backgroundWhileAgents" @toggle="toggleBackground('whileAgents')" />
        </Setting>
        <Setting
          :name="t('settings.ai.GeneralSettings.keep_running_in_background_always.ea405fee')"
          :desc="t('settings.ai.GeneralSettings.play_silent_audio_even_when.1582869f')"
        >
          <Checkbox :is-enabled="backgroundAlways" @toggle="toggleBackground('always')" />
        </Setting>
      </template>
      <Setting
        :name="t('settings.ai.GeneralSettings.key_destinations.fe672569')"
        :desc="t('settings.ai.GeneralSettings.review_addresses_changed_outside_this.3108ccee')"
      >
        <Button
          :text="t('settings.ai.GeneralSettings.review.aff0766a')"
          :tooltip="t('settings.ai.GeneralSettings.review_and_confirm_where_this.d9c7c591')"
          @click="reviewKeyDestinations"
        />
      </Setting>
      <Section :title="t('settings.ai.GeneralSettings.chat_storage.b1ad73cf')">
        <Setting
          :name="t('settings.ai.GeneralSettings.chat_path_template.306fa23b')"
          :desc="
            t('settings.ai.GeneralSettings.path_template_for_chat_files.68eb138e', {
              value0: String(NAME_TOKEN),
              value1: String(DATE_TOKEN),
            })
          "
        >
          <Input
            :model-value="chatFolder"
            :placeholder="t('settings.ai.GeneralSettings.ai_chats.f579b34b')"
            @update:model-value="updateField('chatFolder', $event)"
          />
        </Setting>

        <Setting
          :name="t('settings.ai.GeneralSettings.rewind_space_mb.a3eaae55')"
          :desc="t('settings.ai.GeneralSettings.how_much_room_on_this.f5c80989')"
        >
          <Input
            :model-value="String(rewindLimitMb)"
            placeholder="100"
            @update:model-value="updateField('rewindLimitMb', $event)"
          />
        </Setting>

        <Setting
          :name="t('settings.ai.GeneralSettings.migrate_chats.cd7a094d')"
          :desc="t('settings.ai.GeneralSettings.move_existing_chat_files_to.6ae0ce3b')"
        >
          <Button
            :text="
              migrating
                ? t('settings.ai.GeneralSettings.migrating.e3c84baf')
                : t('settings.ai.GeneralSettings.migrate.f988ed29')
            "
            :disabled="migrating"
            :tooltip="t('settings.ai.GeneralSettings.move_existing_chat_files_to.2048cf22')"
            @click="migrateChats"
          />
        </Setting>

        <Setting
          :name="t('settings.ai.GeneralSettings.comment_agent.42067bbf')"
          :desc="t('settings.ai.GeneralSettings.which_agent_answers_comment_chats.d8ddd0b0')"
        >
          <Dropdown
            :model-value="commentAgentId"
            :options="commentAgentOptions"
            @update:model-value="updateField('commentAgentId', $event)"
          />
        </Setting>

        <Setting
          :name="t('settings.ai.GeneralSettings.comment_folder.0f39b86a')"
          :desc="t('settings.ai.GeneralSettings.where_comment_chats_are_stored.dcd58501')"
        >
          <Input
            :model-value="commentFolder"
            :placeholder="t('settings.ai.GeneralSettings.ai_comments.e01654c6')"
            @update:model-value="updateField('commentFolder', $event)"
          />
        </Setting>
      </Section>

      <Section :title="t('settings.ai.GeneralSettings.skills.66d0f523')">
        <Setting
          :name="t('settings.ai.GeneralSettings.skills_folder.bc563bf9')"
          :desc="t('settings.ai.GeneralSettings.skills_here_are_offered_to.32a3926b')"
        >
          <Input
            :model-value="skillsFolder"
            :placeholder="t('settings.ai.GeneralSettings.ai_skills.cebb9b9a')"
            @update:model-value="updateField('skillsFolder', $event)"
          />
        </Setting>
      </Section>

      <Section :title="t('settings.ai.GeneralSettings.integrations.090512d9')">
        <Setting
          :name="t('settings.ai.GeneralSettings.brave_search_api_key.309e5bff')"
          :desc="t('settings.ai.GeneralSettings.stored_securely_in_keychain.0d11e7d5')"
        >
          <SecretField
            :value="storedSecret(braveSearchApiKey)"
            :model-value="braveSecretInput"
            :placeholder="'BSA...'"
            @update:model-value="braveSecretInput = $event"
            @save="applyBraveSecret"
          />
        </Setting>
      </Section>

      <Section :title="t('settings.ai.GeneralSettings.secrets.d8707d41')">
        <template #desc>
          <I18nText :text="t('settings.rich.3cf5061d7d4aaae2', { slot0: '⟪slot0⟫' })"
            ><template #slot0><code>${abele_key:name}</code></template></I18nText
          >
        </template>

        <CardGrid>
          <Card
            v-for="(secret, sIdx) in secrets"
            :key="secret.id"
            :title="secret.name || t('settings.ai.GeneralSettings.unnamed.9edb143e')"
            :subtitle="
              editingSecretIdx === sIdx ? undefined : getSecretDisplay(secret.keyId) || '(not set)'
            "
            :clickable="editingSecretIdx !== sIdx"
            @click="startEditSecret(sIdx)"
          >
            <!--
              Clicks inside the open editor must not reach the card, which would read them as
              "open me". Save and Cancel both close the card, and the browser runs a microtask
              checkpoint between two listeners of one click — long enough for Vue to re-render
              the card as clickable again before the click finishes bubbling into it.
            -->
            <div v-if="editingSecretIdx === sIdx" class="abele-ai-secret__editor" @click.stop>
              <Input
                :model-value="secret.name"
                :placeholder="t('settings.ai.GeneralSettings.secret_name.5cdf573b')"
                @update:model-value="(v: string) => updateSecretName(sIdx, v)"
              />
              <SecretField
                :value="storedSecret(secret.keyId)"
                :model-value="secretValueInputs[secret.id] || ''"
                :placeholder="t('settings.ai.GeneralSettings.value.fb2e2c72')"
                :replace-placeholder="t('settings.ai.GeneralSettings.value.fb2e2c72')"
                @update:model-value="secretValueInputs[secret.id] = $event"
                @save="applySecretValue(sIdx)"
              />
              <Setting
                :name="t('settings.ai.GeneralSettings.allowed_addresses.0479f7eb')"
                :desc="t('settings.ai.GeneralSettings.add_an_address_from_a.f1ab507c')"
              >
                <div>
                  <div v-for="origin in secret.allowedOrigins || []" :key="origin">
                    <span>{{ origin }}</span>
                    <Button
                      :text="t('settings.ai.GeneralSettings.remove.c3812fc4')"
                      :tooltip="
                        t('settings.ai.GeneralSettings.remove_this_address_from_the.e14aba72')
                      "
                      @click="removeSecretOrigin(sIdx, origin)"
                    />
                  </div>
                  <span v-if="!secret.allowedOrigins?.length">{{
                    t('settings.ai.GeneralSettings.none_yet.adb85cf2')
                  }}</span>
                </div>
              </Setting>
              <div class="abele-ai-secret__row">
                <Icon
                  icon="trash"
                  :tooltip="t('settings.ai.GeneralSettings.remove_this_secret.42b31675')"
                  @click="askRemoveSecret(sIdx)"
                />
                <Icon
                  icon="x"
                  :tooltip="t('settings.ai.GeneralSettings.cancel_leave_the_stored_value.ab838eaa')"
                  @click="cancelEditSecret(sIdx)"
                />
              </div>
            </div>
          </Card>
        </CardGrid>

        <div class="abele-settings__ai-actions">
          <Button
            :text="t('settings.ai.GeneralSettings.add_secret.f57a23c6')"
            :tooltip="t('settings.ai.GeneralSettings.add_another_named_secret.16c8806f')"
            @click="addSecret"
          />
        </div>
      </Section>
    </template>

    <template v-if="enabled && page === 'models'">
      <Section :title="t('settings.ai.GeneralSettings.providers.996c32b3')">
        <ProviderSettings
          v-for="(provider, pIdx) in providers"
          :key="provider.id"
          :name="provider.name"
          :client-name="provider.clientName"
          :secret-value="storedSecret(provider.apiKeyId)"
          :secret-input="secretInputs[provider.id] || ''"
          :summary="modelCount(provider.models?.length ?? 0)"
          @update:name="updateProvider(pIdx, 'name', $event)"
          @update:client-name="updateProvider(pIdx, 'clientName', $event)"
          @update:secret-input="secretInputs[provider.id] = $event"
          @save-secret="applyProviderSecret(pIdx)"
          @remove="askRemoveProvider(pIdx)"
        >
          <template #endpoint>
            <Setting
              :name="t('settings.ai.GeneralSettings.base_url.70589413')"
              :desc="t('settings.ai.GeneralSettings.openai_compatible_api_endpoint.7e47af2e')"
            >
              <Input
                :model-value="provider.baseUrl"
                placeholder="https://api.openai.com/v1"
                @update:model-value="updateProvider(pIdx, 'baseUrl', $event)"
              />
            </Setting>
          </template>

          <template #model-actions>
            <Icon
              icon="download"
              :tooltip="t('settings.ai.GeneralSettings.fetch_models_from_api.f5eaa7ef')"
              :disabled="!provider.baseUrl || !provider.apiKeyId || fetchingModels === pIdx"
              @click="fetchModels(pIdx)"
            />
            <Icon
              icon="plus"
              :tooltip="t('settings.ai.GeneralSettings.add_model_manually.c42ee506')"
              @click="addModel(pIdx)"
            />
          </template>

          <!-- Fetched models picker -->
          <div v-if="remoteModels[provider.id]?.length" class="abele-ai-provider__remote-models">
            <div class="abele-ai-provider__remote-label">
              {{
                t('settings.sentence.c93c0ada01c57a48', {
                  value0: String(remoteModels[provider.id].length),
                })
              }}
            </div>
            <input
              type="text"
              class="abele-obsidian-input"
              :placeholder="t('settings.ai.GeneralSettings.filter_models.e91fd9af')"
              :value="modelFilter[provider.id] || ''"
              @input="modelFilter[provider.id] = ($event.target as HTMLInputElement).value"
            />
            <div class="abele-ai-provider__remote-list">
              <div
                v-for="rm in filteredRemoteModels(provider.id)"
                :key="rm.id"
                class="abele-ai-provider__remote-item"
                :class="{
                  'abele-ai-provider__remote-item_added': isModelAdded(pIdx, rm.id),
                }"
                @click="toggleRemoteModel(pIdx, rm.id)"
              >
                <Checkbox
                  :is-enabled="isModelAdded(pIdx, rm.id)"
                  @click.stop
                  @toggle="toggleRemoteModel(pIdx, rm.id)"
                />
                <span>{{ rm.id }}</span>
                <span v-if="rm.owned_by" class="abele-ai-provider__remote-owner">
                  {{ rm.owned_by }}
                </span>
              </div>
            </div>
          </div>

          <div v-if="fetchError[provider.id]" class="abele-ai-provider__fetch-error">
            {{ fetchError[provider.id] }}
          </div>

          <CardGrid>
            <Card
              v-for="(model, mIdx) in provider.models"
              :key="mIdx"
              :title="model.name || model.id"
              :subtitle="model.id"
              :meta="[
                formatTokens(model.contextWindow) + ' ctx',
                formatTokens(model.maxTokens) + ' out',
              ]"
              clickable
              @click="openModelEdit(pIdx, mIdx)"
            >
              <template #badges>
                <Badge
                  v-if="model.supportsReasoning"
                  :text="t('settings.ai.GeneralSettings.reasoning.0c4d01e8')"
                />
              </template>
            </Card>
          </CardGrid>

          <EmptyState
            v-if="!provider.models.length"
            :text="t('settings.ai.GeneralSettings.no_models_yet.36604ff4')"
          />

          <ModelEditModal
            v-if="editingModel?.pIdx === pIdx"
            :model="editingModel.model"
            :is-new="editingModel.isNew"
            @save="onModelSave(pIdx, editingModel.mIdx, $event)"
            @delete="removeModel(pIdx, editingModel.mIdx)"
            @close="editingModel = null"
          />
        </ProviderSettings>

        <Setting
          :name="
            providers.length
              ? t('settings.ai.GeneralSettings.add_another_provider.91f9cd40')
              : t('settings.ai.GeneralSettings.no_providers_yet.55327313')
          "
          :desc="t('settings.ai.GeneralSettings.any_service_that_speaks_the.e99bc8c8')"
        >
          <Button
            :text="t('settings.ai.GeneralSettings.add_provider.8cd1856b')"
            :tooltip="
              t('settings.ai.GeneralSettings.add_another_openai_compatible_provider.14842bd7')
            "
            @click="addProvider"
          />
        </Setting>
      </Section>

      <Section
        :title="t('settings.ai.GeneralSettings.background_model.eefa747e')"
        :desc="t('settings.ai.GeneralSettings.chat_models_are_chosen_per.1867a8fa')"
      >
        <Setting
          :name="t('settings.ai.GeneralSettings.auxiliary_model.6c245762')"
          :desc="t('settings.ai.GeneralSettings.used_for_chat_titles_and.d3db0143')"
        >
          <Dropdown
            :model-value="auxModelKey"
            :options="[
              { value: '', display: t('settings.ai.GeneralSettings.same_as_the_chat.3e206eff') },
              ...modelOptions,
            ]"
            @update:model-value="selectAuxModel($event)"
          />
        </Setting>

        <Setting
          :name="t('settings.ai.GeneralSettings.sequential_auxiliary.f9fb6da7')"
          :desc="t('settings.ai.GeneralSettings.run_auxiliary_tasks_after_the.d26cd159')"
        >
          <Checkbox :is-enabled="sequentialAuxiliary" @toggle="toggleSequentialAuxiliary" />
        </Setting>
      </Section>

      <Section
        :title="t('settings.ai.GeneralSettings.when_a_request_fails.8adc1690')"
        :desc="t('settings.ai.GeneralSettings.only_failures_that_pass_on.40e2ce33')"
      >
        <Setting
          :name="t('settings.ai.GeneralSettings.try_again_automatically.84c6a3e7')"
          :desc="t('settings.ai.GeneralSettings.how_many_further_tries_after.21ca31fd')"
        >
          <Dropdown
            :model-value="String(retry.attempts)"
            :options="[
              { value: '0', display: t('settings.ai.GeneralSettings.off.ca7981b4') },
              { value: '1', display: t('settings.ai.GeneralSettings.once.d88f6d83') },
              { value: '2', display: t('settings.ai.GeneralSettings.twice.cc1b4c8d') },
              { value: '3', display: t('settings.ai.GeneralSettings.three_times.13b6376c') },
              { value: '5', display: t('settings.ai.GeneralSettings.five_times.ee32f27e') },
            ]"
            @update:model-value="setRetry('attempts', Number($event))"
          />
        </Setting>

        <Setting
          v-if="retry.attempts > 0"
          :name="t('settings.ai.GeneralSettings.first_wait.548b0480')"
          :desc="t('settings.ai.GeneralSettings.seconds_before_the_first_retry.60ee00fb')"
        >
          <Input
            :model-value="String(Math.round(retry.firstDelayMs / 1000))"
            @update:model-value="setRetry('firstDelayMs', Math.max(1, Number($event) || 1) * 1000)"
          />
        </Setting>
      </Section>
      <Setting
        :name="t('settings.ai.GeneralSettings.request_timeout_seconds.1b1b1d08')"
        :desc="t('settings.ai.GeneralSettings.wait_for_the_model_to.230c11b5')"
      >
        <Input
          :model-value="timeoutInput"
          data-testid="settings-request-timeout"
          :aria-invalid="timeoutError ? 'true' : undefined"
          placeholder="60"
          @update:model-value="setRequestTimeout($event)"
        />
        <div v-if="timeoutError" class="setting-item-description" role="alert">
          {{ timeoutError }}
        </div>
      </Setting>

      <Section
        :title="t('settings.ai.GeneralSettings.voice_input.8748f239')"
        :desc="t('settings.ai.GeneralSettings.dictate_into_the_chat_or.6ffa829a')"
      >
        <Setting
          :name="t('settings.ai.GeneralSettings.model.5e2c614c')"
          :desc="t('settings.ai.GeneralSettings.what_turns_speech_into_text.7083143f')"
        >
          <Dropdown
            :model-value="voiceModelChoice"
            :options="voiceModelOptions"
            @update:model-value="chooseVoiceModel"
          />
        </Setting>

        <Setting v-if="voiceModelNote" :name="voiceModelName" :desc="voiceModelNote" />

        <template v-if="voiceModelChoice === 'custom'">
          <Setting
            :name="t('settings.ai.GeneralSettings.model_id.7789530b')"
            :desc="t('settings.ai.GeneralSettings.any_model_that_accepts_audio.ee899177')"
          >
            <Input
              :model-value="voice.modelId"
              :placeholder="t('settings.ai.GeneralSettings.vendor_model.ba723767')"
              @update:model-value="setVoice('modelId', $event)"
            />
          </Setting>
          <Setting
            :name="t('settings.ai.GeneralSettings.endpoint.3df9726c')"
            :desc="t('settings.ai.GeneralSettings.left_empty_openrouter_s_chat.cfc34cb7')"
          >
            <Input
              :model-value="voice.endpoint"
              placeholder="https://openrouter.ai/api/v1/chat/completions"
              @update:model-value="setVoice('endpoint', $event)"
            />
          </Setting>
        </template>

        <Setting
          :name="t('settings.ai.GeneralSettings.language.a4fe6526')"
          :desc="t('settings.ai.GeneralSettings.told_to_the_model_as.35170cef')"
        >
          <Input
            :model-value="voice.language"
            :placeholder="t('settings.ai.GeneralSettings.russian.5bcc40ad')"
            @update:model-value="setVoice('language', $event)"
          />
        </Setting>

        <Setting
          :name="t('settings.ai.GeneralSettings.client_name.b6626cd7')"
          :desc="settingsLabel(CLIENT_NAME_DESCRIPTION)"
        >
          <Input
            :model-value="voice.clientName || ''"
            :placeholder="t('settings.ai.GeneralSettings.default.21b111cb')"
            @update:model-value="setVoice('clientName', $event)"
          />
        </Setting>

        <Setting
          :name="t('settings.ai.GeneralSettings.openrouter_api_key.89616b71')"
          :desc="t('settings.ai.GeneralSettings.stored_in_the_keychain_shared.26300c21')"
        >
          <SecretField
            :value="storedSecret(voiceKeyName)"
            :model-value="voiceSecretInput"
            :placeholder="'sk-or-...'"
            @update:model-value="voiceSecretInput = $event"
            @save="applyVoiceSecret"
          />
        </Setting>
      </Section>

      <Section :title="t('settings.ai.GeneralSettings.image_generation.8f4716e6')">
        <Setting :name="t('image.timeLimit.label')">
          <Dropdown
            :model-value="String(imageGenerationTimeLimitMinutes)"
            :options="
              [0, 2, 5, 10, 30].map((minutes) => ({
                value: String(minutes),
                display: minutes
                  ? t('image.timeLimit.minutes', { minutes })
                  : t('image.timeLimit.unlimited'),
              }))
            "
            @update:model-value="setImageTimeLimit"
          />
        </Setting>
        <ProviderSettings
          v-for="(ip, ipIdx) in imageProviders"
          :key="ipIdx"
          :name="ip.name"
          :client-name="ip.clientName"
          :secret-value="storedSecret(ip.apiKeyId)"
          :secret-input="imgSecretInputs[ip.id] || ''"
          :summary="modelCount(ip.models?.length ?? 0)"
          @update:name="updateImageProvider(ipIdx, 'name', $event)"
          @update:client-name="updateImageProvider(ipIdx, 'clientName', $event)"
          @update:secret-input="imgSecretInputs[ip.id] = $event"
          @save-secret="applyImageProviderSecret(ipIdx)"
          @remove="askRemoveImageProvider(ipIdx)"
        >
          <template #identity>
            <Setting
              name="ID"
              :desc="t('settings.ai.GeneralSettings.short_identifier_used_in_model.1846b226')"
            >
              <Input
                :model-value="ip.id"
                :placeholder="
                  t('settings.ai.GeneralSettings.e_g_openai.e3ce2f3c', {
                    literal0: String('openai'),
                  })
                "
                @update:model-value="updateImageProvider(ipIdx, 'id', $event)"
              />
            </Setting>
          </template>
          <template #endpoint>
            <Setting
              :name="t('settings.ai.GeneralSettings.api_type.72e7cc4c')"
              :desc="t('settings.ai.GeneralSettings.openai_uses_v_images_generations.12e3117d')"
            >
              <Dropdown
                :model-value="ip.apiType"
                :options="IMAGE_API_TYPES"
                @update:model-value="updateImageProvider(ipIdx, 'apiType', $event)"
              />
            </Setting>
            <Setting
              :name="t('settings.ai.GeneralSettings.endpoint.3df9726c')"
              :desc="
                t('settings.ai.GeneralSettings.leave_empty_for_default.ac9c8df3') +
                imgEndpointDefault(ip.apiType)
              "
            >
              <Input
                :model-value="ip.endpoint"
                :placeholder="imgEndpointDefault(ip.apiType)"
                @update:model-value="updateImageProvider(ipIdx, 'endpoint', $event)"
              />
            </Setting>
          </template>

          <template #model-actions>
            <Icon
              icon="plus"
              :tooltip="t('settings.ai.GeneralSettings.add_model.b2609f7d')"
              @click="addImageModel(ipIdx)"
            />
          </template>

          <CardGrid>
            <Card
              v-for="(im, imIdx) in ip.models"
              :key="imIdx"
              :title="im.name || im.id"
              :subtitle="`${ip.id}::${im.id}`"
              :meta="ip.apiType === 'openai' ? [im.size, im.quality, im.outputFormat] : []"
              clickable
              @click="openImageModelEdit(ipIdx, imIdx)"
            />
          </CardGrid>

          <ImageModelEditModal
            v-if="editingImageModel?.pIdx === ipIdx"
            :model="editingImageModel.model"
            :is-new="editingImageModel.isNew"
            :is-open-ai="ip.apiType === 'openai'"
            @save="onImageModelSave(ipIdx, editingImageModel.mIdx, $event)"
            @delete="removeImageModel(ipIdx, editingImageModel.mIdx)"
            @close="editingImageModel = null"
          />
        </ProviderSettings>

        <Setting
          :name="
            imageProviders.length
              ? t('settings.ai.GeneralSettings.add_another_image_provider.fac89d72')
              : t('settings.ai.GeneralSettings.no_image_providers_yet.03ad87ca')
          "
          :desc="t('settings.ai.GeneralSettings.a_service_that_makes_pictures.a39241cb')"
        >
          <Button
            :text="t('settings.ai.GeneralSettings.add_image_provider.858726bf')"
            :tooltip="
              t('settings.ai.GeneralSettings.add_another_image_generation_provider.8a3f2ea9')
            "
            @click="addImageProvider"
          />
        </Setting>

        <Setting
          :name="t('settings.ai.GeneralSettings.default_image_model.164d9980')"
          :desc="t('settings.ai.GeneralSettings.used_when_agent_doesn_t.a37bbc88')"
        >
          <Dropdown
            :model-value="defaultImageModel"
            :options="[
              { value: '', display: t('settings.ai.GeneralSettings.not_configured.dd1841d2') },
              ...imageModelOptions,
            ]"
            @update:model-value="selectDefaultImageModel"
          />
        </Setting>
      </Section>
    </template>

    <template v-if="enabled && page === 'prompts'">
      <!-- What the plugin tells the models, rarely changed: a prompt a row, saying whether it is
           still the plugin's own, and its words in a window of their own. -->
      <Section
        :title="t('settings.ai.GeneralSettings.prompts.5f2e66e6')"
        :desc="t('settings.ai.GeneralSettings.what_the_plugin_says_to.b62716b4')"
      >
        <Setting
          :name="t('settings.ai.GeneralSettings.tool_descriptions.eb258712')"
          :desc="t('settings.ai.GeneralSettings.what_each_tool_tells_the.577cc136')"
        >
          <StatusDot
            v-if="toolDescriptionsChanged"
            tone="accent"
            :label="
              t('settings.ai.GeneralSettings.value_changed_from_the_plugin.6bb25106', {
                value0: String(toolDescriptionsChanged),
              })
            "
          />
          <Icon
            icon="pencil"
            :tooltip="t('settings.ai.GeneralSettings.change_what_the_tools_tell.4a192e39')"
            @click="editingTools = true"
          />
        </Setting>
        <Setting v-for="row in PROMPT_ROWS" :key="row.key" :name="row.name" :desc="row.desc">
          <StatusDot
            v-if="isChanged(row.key)"
            tone="accent"
            :label="t('settings.ai.GeneralSettings.changed_from_the_plugin_s.5eaba5ab')"
          />
          <Icon
            icon="pencil"
            :tooltip="
              t('settings.ai.GeneralSettings.change_the_value_prompt.e3b3d921', {
                value0: String(row.name.toLowerCase()),
              })
            "
            @click="editPrompt(row)"
          />
        </Setting>
      </Section>

      <ObsidianModal v-if="editingPrompt" :title="editingPrompt.name" @close="editingPrompt = null">
        <p class="abele-ai-prompts__about">{{ editingPrompt.desc }}</p>
        <Input
          v-model="promptDraft"
          as-text-area
          class="abele-ai-prompts__text"
          :rows="12"
          :placeholder="defaultPrompts[editingPrompt.key]"
          :aria-label="editingPrompt.name"
        />
        <template #footer>
          <Button
            :text="t('settings.ai.GeneralSettings.use_the_default.76f7faf5')"
            :tooltip="t('settings.ai.GeneralSettings.go_back_to_the_plugin.03eb09fb')"
            :disabled="!promptDraft"
            @click="promptDraft = ''"
          />
          <Button
            :text="t('settings.ai.GeneralSettings.cancel.19766ed6')"
            :tooltip="t('settings.ai.GeneralSettings.close_this_and_change_nothing.80f7e492')"
            @click="editingPrompt = null"
          />
          <Button
            :text="t('settings.ai.GeneralSettings.save.1509f561')"
            :tooltip="t('settings.ai.GeneralSettings.use_these_words_from_now.0d2b4a3d')"
            accent
            @click="savePrompt"
          />
        </template>
      </ObsidianModal>

      <ObsidianModal
        v-if="editingTools"
        :title="t('settings.ai.GeneralSettings.tool_descriptions.eb258712')"
        size="wide"
        @close="editingTools = false"
      >
        <ToolDescriptions
          :descriptions="customToolDescriptions"
          @update="onToolDescriptionUpdate"
        />
        <template #footer>
          <Button
            :text="t('settings.ai.GeneralSettings.done.11a6767d')"
            :tooltip="t('settings.ai.GeneralSettings.close_this_window.3f02fc8e')"
            accent
            @click="editingTools = false"
          />
        </template>
      </ObsidianModal>
    </template>

    <template v-if="enabled">
      <ConfirmModal
        v-if="pendingRemoval"
        :title="pendingRemoval.title"
        :message="pendingRemoval.message"
        :confirm-tooltip="pendingRemoval.title"
        @confirm="pendingRemoval.run()"
        @close="pendingRemoval = null"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { settingsCount } from '@/i18n/settingsCounts'
import { settingsLabel } from '@/i18n/settingsLabels'
import I18nText from '@/components/obsidian/I18nText.vue'
import { t } from '@/i18n'
import { DEFAULT_REWIND_LIMIT_MB } from '@/ai/rewind/ChatRewind'
import { mobileBackground } from '@/ai/mobileBackground'
import { keyDestinations, acceptIntroducedDestinations } from '@/secrets/destinations'
import { reviewKeyDestinations } from '@/secrets/destinationReview'
import { secrets as secretStore } from '@/secrets/SecretStore'
import { MEMORY_PLACEHOLDER } from '@/ai/agents/memory'
import { ref, computed, reactive, watch, onBeforeUnmount } from 'vue'
import { Notice, Platform, debounce } from 'obsidian'
import { nanoid } from 'nanoid'
import Setting from '../../obsidian/Setting.vue'
import Input from '../../obsidian/Input.vue'
import Button from '../../obsidian/Button.vue'
import Checkbox from '../../obsidian/Checkbox.vue'
import Dropdown from '../../obsidian/Dropdown.vue'
import Section from '../../obsidian/Section.vue'
import Card from '../../obsidian/Card.vue'
import CardGrid from '../../obsidian/CardGrid.vue'
import Badge from '../../obsidian/Badge.vue'
import EmptyState from '../../obsidian/EmptyState.vue'
import ConfirmModal from '../../obsidian/ConfirmModal.vue'
import ToolDescriptions from './ToolDescriptions.vue'
import ObsidianModal from '../../obsidian/Modal.vue'
import ModelEditModal from '../ModelEditModal.vue'
import ImageModelEditModal from '../ImageModelEditModal.vue'
import Icon from '../../obsidian/Icon.vue'
import StatusDot from '../../obsidian/StatusDot.vue'
import SecretField from '../SecretField.vue'
import ProviderSettings from './ProviderSettings.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { savedKeysWithIds } from '@/ai/savedKeyIds'
import { TRANSCRIPTION_MODELS } from '@/ai/transcription'
import { DEFAULT_RETRY, type RetrySettings } from '@/ai/retry'
import { DEFAULT_VOICE_SETTINGS, voiceKeyId, type VoiceSettings } from '@/ai/transcriptionSettings'
import { CLIENT_NAME_DESCRIPTION } from '@/ai/client/clientName'
import { ChatStorage } from '@/ai/ChatStorage'
import { CommentService } from '@/ai/CommentService'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { useAiProviderModels } from '@/composables/useAiProviderModels'
import { useAiImageModels } from '@/composables/useAiImageModels'
import type { AiProvider, AiPrompts, AiSecret } from '@/ai/types'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { requestTimeoutSeconds, MAX_REQUEST_TIMEOUT_SECONDS } from '@/ai/requestTimeout'

/** Written out in script: nested moustaches in the template confuse the Vue parser. */
const NAME_TOKEN = '{{name}}'
const DATE_TOKEN = '{{date:YYYY-MM-DD}}'
const MESSAGES_TOKEN = '{{messages}}'
const MEMORY_TOKEN = MEMORY_PLACEHOLDER

const IMAGE_API_TYPES = [
  { value: 'openai', display: 'OpenAI' },
  { value: 'openrouter', display: 'OpenRouter' },
]

/**
 * The question standing between a trash icon and something being gone. One slot: only one
 * dialog can be open, and holding the action itself keeps the wiring in one place.
 */
withDefaults(
  defineProps<{
    /** Which tab of the agent's settings this is. */
    page?: 'general' | 'models' | 'prompts'
  }>(),
  { page: 'general' }
)

const pendingRemoval = ref<{ title: string; message: string; run: () => void } | null>(null)

function askRemoval(title: string, message: string, run: () => void): void {
  pendingRemoval.value = { title, message, run }
}

const config = AbeleConfig.getInstance()
const migrating = ref(false)

const migrateChats = async () => {
  migrating.value = true
  try {
    const count = await ChatStorage.getInstance().migrateChats()
    new Notice(
      t('settings.ai.GeneralSettings.migrated_value_chat_s.9cf610c9', { value0: String(count) })
    )
  } catch (err: unknown) {
    new Notice(
      t('settings.ai.GeneralSettings.migration_failed_value.109b5f7f', {
        value0: String(err instanceof Error ? err.message : err),
      })
    )
  } finally {
    migrating.value = false
  }
}

const enabled = ref(config.ai.enabled)
const providers = ref<AiProvider[]>(JSON.parse(JSON.stringify(config.ai.providers)))
const chatFolder = ref(config.ai.chatFolder)
const skillsFolder = ref(config.ai.skillsFolder ?? '')
const rewindLimitMb = ref(config.ai.rewindLimitMb ?? DEFAULT_REWIND_LIMIT_MB)
const commentAgentId = ref(config.ai.commentAgentId ?? '')
const commentFolder = ref(config.ai.commentFolder ?? DEFAULT_AI_SETTINGS.commentFolder)

/**
 * Utility agents are on this list on purpose, unlike the chat picker's: a comment agent is
 * meant to be a utility one, and the agent seeded for comments is created that way. The empty
 * value is the default agent, not 'none' — a comment always runs on something.
 */
const commentAgentOptions = computed(() => [
  { value: '', display: t('settings.ai.GeneralSettings.default_agent.94da52ec') },
  ...AgentRegistry.getInstance()
    .list({ includeUtility: true })
    .map((agent) => ({ value: agent.id, display: agent.name })),
])
const braveSearchApiKey = ref(config.ai.braveSearchApiKey)
const imageGenerationTimeLimitMinutes = ref(config.ai.imageGenerationTimeLimitMinutes ?? 0)
const setImageTimeLimit = (value: string) => {
  imageGenerationTimeLimitMinutes.value = Number(value) as 0 | 2 | 5 | 10 | 30
  save()
}
const imageProviders = ref(JSON.parse(JSON.stringify(config.ai.imageProviders || [])))
const defaultImageModel = ref(config.ai.defaultImageModel || '')
const imgSecretInputs = reactive<Record<string, string>>({})
const secretRows = (items: AiSecret[]) =>
  savedKeysWithIds(JSON.parse(JSON.stringify(items)) as AiSecret[])
const secrets = ref(secretRows(config.ai.secrets || []))
const secretValueInputs = reactive<Record<string, string>>({})
const auxiliaryModelId = ref(config.ai.auxiliaryModelId)
const sequentialAuxiliary = ref(config.ai.sequentialAuxiliary)
const modelRequestTimeout = ref(requestTimeoutSeconds(config.ai.requestTimeoutSeconds))
const timeoutInput = ref(String(modelRequestTimeout.value))
const timeoutError = computed(() => {
  const seconds = Number(timeoutInput.value)
  return timeoutInput.value.trim() !== '' &&
    (!Number.isFinite(seconds) || seconds < 1 || seconds > MAX_REQUEST_TIMEOUT_SECONDS)
    ? t('settings.ai.GeneralSettings.enter_seconds_this_value_has.ec39a7c9')
    : ''
})

const setRequestTimeout = (value: string) => {
  timeoutInput.value = value
  if (timeoutError.value) return
  const seconds = value.trim() === '' ? requestTimeoutSeconds(undefined) : Number(value)
  modelRequestTimeout.value = seconds
  save()
}
const prompts = ref<Partial<AiPrompts>>(
  config.ai.prompts ? JSON.parse(JSON.stringify(config.ai.prompts)) : {}
)
const defaultPrompts = DEFAULT_AI_SETTINGS.prompts
const customToolDescriptions = computed(() => prompts.value.toolDescriptions || {})

const onToolDescriptionUpdate = (toolName: string, value: string) => {
  const descs = { ...(prompts.value.toolDescriptions || {}) }
  if (value) {
    descs[toolName] = value
  } else {
    delete descs[toolName]
  }
  prompts.value = { ...prompts.value, toolDescriptions: descs }
  save()
}

const {
  remoteModels,
  fetchingModels,
  fetchError,
  modelFilter,
  filteredRemoteModels,
  auxModelKey,
  modelOptions,
  addProvider,
  askRemoveProvider,
  updateProvider,
  fetchModels,
  isModelAdded,
  toggleRemoteModel,
  editingModel,
  addModel,
  openModelEdit,
  onModelSave,
  removeModel,
  formatTokens,
  selectAuxModel,
} = useAiProviderModels({ config, providers, auxiliaryModelId, save: () => save(), askRemoval })

let pendingSave = false
const write = () => {
  pendingSave = false
  void config
    .saveSettings()
    .catch((err) => console.error('[Abele] Failed to save AI settings', err))
}
const persist = debounce(write, 500, true)
const save = () => {
  config.editSettings(() => {
    const before = keyDestinations(config)
    applyFields()
    acceptIntroducedDestinations(before, keyDestinations(config))
  })
  pendingSave = true
  persist()
}

const applyFields = () => {
  // Merged, never rebuilt. This tab owns providers, keys and background prompts; agents,
  // scripts and chat history belong to other screens, and a wholesale rebuild would silently
  // drop whatever this component does not happen to know about.
  config.ai = {
    ...config.ai,
    enabled: enabled.value,
    backgroundWhileAgents: backgroundWhileAgents.value,
    backgroundAlways: backgroundAlways.value,
    providers: JSON.parse(JSON.stringify(providers.value)),
    auxiliaryModelId: auxiliaryModelId.value,
    sequentialAuxiliary: sequentialAuxiliary.value,
    requestTimeoutSeconds: modelRequestTimeout.value,
    chatFolder: chatFolder.value,
    rewindLimitMb: rewindLimitMb.value,
    commentAgentId: commentAgentId.value,
    commentFolder: commentFolder.value,
    skillsFolder: skillsFolder.value.trim().replace(/^\/+|\/+$/g, ''),
    braveSearchApiKey: braveSearchApiKey.value,
    imageGenerationTimeLimitMinutes: imageGenerationTimeLimitMinutes.value,
    imageProviders: JSON.parse(JSON.stringify(imageProviders.value)),
    defaultImageModel: defaultImageModel.value,
    secrets: JSON.parse(JSON.stringify(secrets.value)),
    prompts: JSON.parse(JSON.stringify(prompts.value)),
    autoRetry: { ...retry.value },
    voice: { ...voice.value },
  }
}

watch(config.version, () => {
  enabled.value = config.ai.enabled
  backgroundWhileAgents.value = config.ai.backgroundWhileAgents === true
  backgroundAlways.value = config.ai.backgroundAlways === true
  providers.value = JSON.parse(JSON.stringify(config.ai.providers))
  auxiliaryModelId.value = config.ai.auxiliaryModelId
  sequentialAuxiliary.value = config.ai.sequentialAuxiliary
  modelRequestTimeout.value = requestTimeoutSeconds(config.ai.requestTimeoutSeconds)
  timeoutInput.value = String(modelRequestTimeout.value)
  chatFolder.value = config.ai.chatFolder
  rewindLimitMb.value = config.ai.rewindLimitMb ?? DEFAULT_REWIND_LIMIT_MB
  commentAgentId.value = config.ai.commentAgentId ?? ''
  commentFolder.value = config.ai.commentFolder ?? DEFAULT_AI_SETTINGS.commentFolder
  braveSearchApiKey.value = config.ai.braveSearchApiKey
  imageGenerationTimeLimitMinutes.value = config.ai.imageGenerationTimeLimitMinutes ?? 0
  imageProviders.value = JSON.parse(JSON.stringify(config.ai.imageProviders || []))
  defaultImageModel.value = config.ai.defaultImageModel || ''
  secrets.value = secretRows(config.ai.secrets || [])
  const retained = new Set(secrets.value.map((secret) => secret.id))
  for (const id of Object.keys(secretValueInputs))
    if (!retained.has(id)) delete secretValueInputs[id]
  if (editingSecretId.value && !retained.has(editingSecretId.value)) {
    editingSecretId.value = null
    secretIsNew = false
  }
  pendingRemoval.value = null
  prompts.value = JSON.parse(JSON.stringify(config.ai.prompts || {}))
  retry.value = { ...DEFAULT_RETRY, ...(config.ai.autoRetry ?? {}) }
  voice.value = { ...DEFAULT_VOICE_SETTINGS, ...(config.ai.voice ?? {}) }
})

onBeforeUnmount(() => {
  persist.cancel?.()
  if (pendingSave) write()
})

const backgroundWhileAgents = ref(config.ai.backgroundWhileAgents === true)
const backgroundAlways = ref(config.ai.backgroundAlways === true)
const toggleBackground = (mode: 'whileAgents' | 'always') => {
  const value = mode === 'whileAgents' ? backgroundWhileAgents : backgroundAlways
  value.value = !value.value
  save()
  mobileBackground.configure(Platform.isMobile, {
    whileAgents: backgroundWhileAgents.value,
    always: backgroundAlways.value,
  })
}

const toggleEnabled = () => {
  enabled.value = !enabled.value
  save()
}

const toggleSequentialAuxiliary = () => {
  sequentialAuxiliary.value = !sequentialAuxiliary.value
  save()
}

// ── Secret helpers ──────────────────────────────────────────

/** The key stored under an id, re-read whenever the keys change. */
const storedSecret = (secretId: string): string => {
  void secretStore().version.value
  return secretId ? secretStore().get(secretId) : ''
}

const getSecretDisplay = (secretId: string): string => {
  if (!secretId) return ''
  const secret = secretStore().get(secretId)
  if (!secret) return ''
  if (secret.length <= 8) return '••••••••'
  return secret.slice(0, 4) + '••••' + secret.slice(-4)
}

const secretInputs = reactive<Record<string, string>>({})
const braveSecretInput = ref('')

const applyProviderSecret = (pIdx: number) => {
  const provider = providers.value[pIdx]
  const value = secretInputs[provider.id]
  if (!value) return
  if (!provider.apiKeyId || !provider.apiKeyId.startsWith('abele-')) {
    provider.apiKeyId = `abele-provider-${provider.id.toLowerCase().replace(/[^a-z0-9-]/g, '')}`
  }
  secretStore().set(provider.apiKeyId, value)
  secretInputs[provider.id] = ''
  save()
}

const applyBraveSecret = () => {
  if (!braveSecretInput.value) return
  braveSearchApiKey.value = 'abele-brave-search'
  secretStore().set('abele-brave-search', braveSecretInput.value)
  braveSecretInput.value = ''
  save()
}

// ── Retrying a failed request ───────────────────────────────

const retry = ref<RetrySettings>({ ...DEFAULT_RETRY, ...(config.ai.autoRetry ?? {}) })

const setRetry = (key: keyof RetrySettings, value: number) => {
  retry.value = { ...retry.value, [key]: value }
  save()
}

// ── Voice input ─────────────────────────────────────────────

const voice = ref<VoiceSettings>({ ...DEFAULT_VOICE_SETTINGS, ...(config.ai.voice ?? {}) })
const voiceSecretInput = ref('')

const voiceKeyName = computed(() => voiceKeyId(voice.value))

const voiceModelOptions = [
  ...TRANSCRIPTION_MODELS.map((model) => ({ value: model.id, display: model.name })),
  { value: 'custom', display: t('settings.ai.GeneralSettings.something_else.b4768d66') },
]

/** A model that is not one of the two is shown as "something else", with its id spelled out. */
const voiceModelChoice = computed(() =>
  TRANSCRIPTION_MODELS.some((model) => model.id === voice.value.modelId)
    ? voice.value.modelId
    : 'custom'
)

const voiceModelName = computed(
  () => TRANSCRIPTION_MODELS.find((m) => m.id === voice.value.modelId)?.name ?? ''
)

const voiceModelNote = computed(
  () => TRANSCRIPTION_MODELS.find((m) => m.id === voice.value.modelId)?.note ?? ''
)

const saveVoice = () => save()

const setVoice = (key: keyof VoiceSettings, value: string) => {
  voice.value = { ...voice.value, [key]: value }
  saveVoice()
}

const chooseVoiceModel = (value: string) => {
  // "Something else" keeps whatever id was there rather than blanking it, so switching back
  // and forth does not lose what was typed.
  if (value !== 'custom') setVoice('modelId', value)
  else if (voiceModelChoice.value !== 'custom') setVoice('modelId', '')
}

const applyVoiceSecret = () => {
  if (!voiceSecretInput.value) return
  secretStore().set(voiceKeyName.value, voiceSecretInput.value)
  voiceSecretInput.value = ''
  saveVoice()
}

const {
  imgEndpointDefault,
  imageModelOptions,
  addImageProvider,
  askRemoveImageProvider,
  updateImageProvider,
  applyImageProviderSecret,
  editingImageModel,
  addImageModel,
  openImageModelEdit,
  onImageModelSave,
  removeImageModel,
  selectDefaultImageModel,
} = useAiImageModels({
  config,
  imageProviders,
  defaultImageModel,
  imgSecretInputs,
  voice,
  save,
  askRemoval,
})

// ── User secrets ────────────────────────────────────────────

const editingSecretId = ref<string | null>(null)
const editingSecretIdx = computed(() =>
  secrets.value.findIndex((secret) => secret.id === editingSecretId.value)
)

/** The name the open card started with, so that cancelling puts it back. */
let secretNameBefore = ''
/** A secret added but never stored — cancelling it should leave nothing behind. */
let secretIsNew = false

const getSecretFullValue = (secretId: string): string => {
  if (!secretId) return ''
  return secretStore().get(secretId) || ''
}

const addSecret = () => {
  secrets.value.push({ id: nanoid(), name: '', keyId: '' })
  startEditSecret(secrets.value.length - 1)
  secretIsNew = true
}

const startEditSecret = (idx: number) => {
  const secret = secrets.value[idx]
  editingSecretId.value = secret.id
  secretNameBefore = secret.name
  secretIsNew = false
  secretValueInputs[secret.id] = secret.keyId ? getSecretFullValue(secret.keyId) : ''
}

/** Closes the card and undoes the sitting, unsaved edit — the name included. */
const cancelEditSecret = (idx: number) => {
  editingSecretId.value = null
  secretValueInputs[secrets.value[idx].id] = ''
  if (secretIsNew) {
    secrets.value.splice(idx, 1)
  } else {
    secrets.value[idx].name = secretNameBefore
  }
  secretIsNew = false
  save()
}

const askRemoveSecret = (idx: number) => {
  const secret = secrets.value[idx]
  askRemoval(
    t('settings.ai.GeneralSettings.remove_secret.1422ca6e'),
    t('settings.secrets.removeNamed', {
      name: secret.name || t('settings.parts.9edb143e79ddd491'),
    }),
    () => {
      const current = secrets.value.findIndex((entry) => entry.id === secret.id)
      if (current !== -1) removeSecret(current)
    }
  )
}

const removeSecret = (idx: number) => {
  const secret = secrets.value[idx]
  if (secret.keyId) {
    try {
      secretStore().set(secret.keyId, '')
    } catch {
      // Invalid keyId from older version — skip keychain cleanup
    }
  }
  secrets.value.splice(idx, 1)
  // Row indices changed: neither an open editor nor a reveal choice belongs to its neighbour.
  editingSecretId.value = null
  secretIsNew = false
  for (const key of Object.keys(secretValueInputs)) delete secretValueInputs[key]
  save()
}

const removeSecretOrigin = (idx: number, origin: string) => {
  secrets.value[idx].allowedOrigins = (secrets.value[idx].allowedOrigins ?? []).filter(
    (entry: string) => entry !== origin
  )
  save()
}

const updateSecretName = (idx: number, name: string) => {
  secrets.value[idx].name = name
  save()
}

const applySecretValue = (idx: number) => {
  const secret = secrets.value[idx]
  if (!secret || secret.id !== editingSecretId.value) return
  const value = secretValueInputs[secret.id]
  if (!value) return
  if (!secret.keyId || !/^[a-z0-9-]+$/.test(secret.keyId)) {
    secret.keyId = `abele-secret-${nanoid(8)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '0')}`
  }
  secretStore().set(secret.keyId, value)
  secretValueInputs[secret.id] = ''
  editingSecretId.value = null
  secretIsNew = false
  // Force re-render so getSecretDisplay() re-evaluates with the new keychain value
  secrets.value = [...secrets.value]
  save()
  new Notice(
    t('settings.ai.GeneralSettings.saved_value_to_the_keychain.9ec0f101', {
      value0: String(secret.name || t('settings.terms.theSecret')),
    })
  )
}

const updateField = (field: string, value: string) => {
  switch (field) {
    case 'chatFolder':
      chatFolder.value = value
      break
    case 'rewindLimitMb': {
      const mb = Number(value.trim())
      // Half-typed or nonsense: the last good number stays until the field reads as one.
      if (value.trim() === '' || !Number.isFinite(mb) || mb < 0) return
      rewindLimitMb.value = mb
      break
    }
    case 'commentAgentId':
      commentAgentId.value = value
      break
    case 'skillsFolder':
      skillsFolder.value = value
      break
    case 'commentFolder':
      commentFolder.value = value
      // Ids that failed to load under the old folder deserve another try under the new one.
      CommentService.getInstance().resetMissing()
      break
  }
  save()
}

const updatePrompt = (field: keyof Omit<AiPrompts, 'toolDescriptions'>, value: string) => {
  prompts.value = { ...prompts.value, [field]: value }
  save()
}

type PromptKey = keyof Omit<AiPrompts, 'toolDescriptions'>
interface PromptRow {
  key: PromptKey
  name: string
  desc: string
}

/** The plugin's own prompts, each in the words of the work it does. */
const PROMPT_ROWS: PromptRow[] = [
  {
    key: 'memoryTemplate',
    name: t('settings.ai.GeneralSettings.agent_memory.f3cd4df6'),
    desc: t('settings.ai.GeneralSettings.how_what_an_agent_was.45d8f0ab', {
      value0: String(MEMORY_TOKEN),
    }),
  },
  {
    key: 'titleGeneration',
    name: t('settings.ai.GeneralSettings.chat_titles.950a9874'),
    desc: t('settings.ai.GeneralSettings.names_a_chat_from_its.b2ea780a', {
      value0: String(MESSAGES_TOKEN),
    }),
  },
  {
    key: 'titleSystem',
    name: t('settings.ai.GeneralSettings.chat_titles_system.2f3fd2f9'),
    desc: t('settings.ai.GeneralSettings.what_the_model_that_names.4a08978e'),
  },
  {
    key: 'recapPrompt',
    name: t('settings.ai.GeneralSettings.chat_recap.adaaf80a'),
    desc: t('settings.ai.GeneralSettings.the_sentence_on_a_chat.af42907c', {
      value0: String(MESSAGES_TOKEN),
    }),
  },
  {
    key: 'summaryPrompt',
    name: t('settings.ai.GeneralSettings.chat_summary.b82dab10'),
    desc: t('settings.ai.GeneralSettings.the_short_line_under_a.c81696a8', {
      value0: String(MESSAGES_TOKEN),
    }),
  },
  {
    key: 'compactPrompt',
    name: t('settings.ai.GeneralSettings.compacting.df77799c'),
    desc: t('settings.ai.GeneralSettings.how_a_long_conversation_is.fb14c886', {
      value0: String(MESSAGES_TOKEN),
    }),
  },
]

const editingPrompt = ref<PromptRow | null>(null)
const promptDraft = ref('')
const editPrompt = (row: PromptRow) => {
  promptDraft.value = prompts.value[row.key] || ''
  editingPrompt.value = row
}
/** Saved as typed; left empty, the plugin's own words are used again. */
const savePrompt = () => {
  if (editingPrompt.value) updatePrompt(editingPrompt.value.key, promptDraft.value)
  editingPrompt.value = null
}

const editingTools = ref(false)
const toolDescriptionsChanged = computed(
  () => Object.values(customToolDescriptions.value).filter(Boolean).length
)

/** Changed means other words than the plugin's own; the same words typed in are not a change. */
const isChanged = (key: PromptKey) => {
  const own = prompts.value[key]
  return !!own && own.trim() !== (defaultPrompts[key] || '').trim()
}

const modelCount = (n: number) => (n === 1 ? settingsCount('model', 1) : settingsCount('model', n))
</script>

<style lang="scss">
.abele-ai-prompts__about {
  margin-top: 0;
  color: var(--text-muted);
  font-size: var(--font-ui-small);
}

.abele-ai-prompts__text {
  width: 100%;
}

.abele-ai-prompts__text textarea.abele-obsidian-input__base {
  width: 100%;
  font-family: var(--font-monospace);
  font-size: var(--font-ui-small);
}

/** Was a bare `<template>`; the wrapper keeps the card's own column layout. */
.abele-ai-secret__editor {
  display: flex;
  flex-direction: column;
  gap: var(--size-2-1);
  min-width: 0;
}

.abele-ai-secret__row {
  display: flex;
  align-items: center;
  gap: var(--size-4-1);
  min-width: 0;
}

.abele-settings__ai-actions {
  margin-top: var(--size-4-4);
}

.abele-ai-provider__remote-models {
  margin-bottom: var(--size-4-2);
}

.abele-ai-provider__remote-label {
  font-size: var(--font-small);
  color: var(--text-muted);
  margin-bottom: var(--size-4-1);
}

.abele-ai-provider__remote-list {
  max-height: 12em;
  overflow-y: auto;
  border: 1px solid var(--background-modifier-border);
  border-radius: var(--radius-s);
}

.abele-ai-provider__remote-item {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
  padding: var(--size-4-1) var(--size-4-2);
  cursor: pointer;
  font-size: var(--font-small);
  min-width: 0;

  > span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  &:hover {
    background-color: var(--background-modifier-hover);
  }

  &_added {
    background-color: var(--background-secondary);
  }
}

.abele-ai-provider__remote-owner {
  color: var(--text-faint);
  margin-left: auto;
}

.abele-ai-provider__fetch-error {
  color: var(--text-error);
  font-size: var(--font-small);
  padding: var(--size-4-1);
}
</style>
