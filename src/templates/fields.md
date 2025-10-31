<% fields.forEach(function(field, index) { %>
<%= index + 1 %>. **<%= field.label %>**
  - **Data Path (data_path)**: "<%= field.path %>"
  - **Label**: <%= field.label %>
  - **Type**: <%= field.type %>
  - **Required**: <% if (field.validation.required) { %>✅ Yes<% } else { %>❌ No<% } %>
  - **Has Nested Components**:  <% if (field.nested) { %>✅ Yes<% } else { %>❌ No<% } %><% if (field.description) { %>
  - **Description**: <%= field.description %><% } %><% if (field.prompt) { %>
  - **Prompt**: <%= field.prompt %><% } %><% if (field.format) { %>
  - **Format**: <%= field.format %><% } %><% if (field.options) { %>
  - **Options**: <% field.options.forEach(function(option) { %>
    - <%= option.label %> (<%= option.value %>)<% }) %><% } %><% if (field.validation && Object.keys(field.validation).length > 0) { %>
  - **Validation**:<% if (field.validation.minLength) { %>
    - Min Length: <%= field.validation.minLength %><% } %><% if (field.validation.maxLength) { %>
    - Max Length: <%= field.validation.maxLength %><% } %><% if (field.validation.pattern) { %>
    - Pattern: <%= field.validation.pattern %><% } %><% if (field.validation.min) { %>
    - Min Value: <%= field.validation.min %><% } %><% if (field.validation.max) { %>
    - Max Value: <%= field.validation.max %><% } %><% } %>
<% }); %>