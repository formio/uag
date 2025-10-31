Total forms (<%= totalForms %> total):

<% _.forEach(forms, function(form) { %>
- <%= form.title %> (**<%= form.name %>**):<% if (form.description) { %>
  - **Description**: <%= form.description %><% } %><% if (!form.hasAccess) { %>
  - **Permissions**: You do not have access to this form.<% } else { %>
  - **Permissions**: <% if (form.permissions.create) { %>Create<% } %><% if (form.permissions.read) { %><% if (form.permissions.create) { %>, <% } %>Read<% } %><% if (form.permissions.update) { %><% if (form.permissions.create || form.permissions.read) { %>, <% } %>Update<% } %> submissions (records)
<% } %><% }); %>

If the user wishes to submit a form they do not have the "Create" permission, then let them know that they do not have the permission to submit that form.

If the user wishes to search for a record and they do not have the "Read" permission, then let them know that they do not have the permission to search for records.

If the user wishes to update an existing record and they do not have the "Update" permission, then let them know that they do not have permission to update records.

If they are simply asking about what forms are available, then you can use this list to provide them simple explaination about the forms available without the need for any permissions.

If the user has permission to perform the operation, and it is clear which form they wish to engage with, then immediately use the `get_form_fields`  tool to understand how the data is structured within this form.
