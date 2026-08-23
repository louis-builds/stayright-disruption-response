using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TravelDisruptionAgent.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddMessageEscalated : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "escalated",
                table: "messages",
                type: "boolean",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "escalated",
                table: "messages");
        }
    }
}
